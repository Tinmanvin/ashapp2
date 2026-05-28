/**
 * Shared posting pipeline for Telegram.
 * Used by both "Post Now" (test) and "Publish on Schedule" (production).
 *
 * Flow for videos over the Telegram limit:
 *   compress in browser → upload compressed blob to R2 → call edge function → delete temp file
 */

import { supabase } from '@/lib/supabase';
import { uploadToR2, deleteFromR2, isR2Configured } from '@/lib/r2';
import { compressVideoForTelegram } from '@/lib/videoCompressor';
import { postToX } from '@/lib/xPoster';
import { postToWebsite } from '@/lib/websitePoster';
import type { ScheduledAsset } from '@/store/schedulerStore';

export type PostStage = 'compressing' | 'uploading' | 'posting' | null;

export interface PostItemCallbacks {
  onStageChange: (stage: PostStage) => void;
  onCompressionProgress: (pct: number) => void;
}

export interface PostResult {
  asset: string;
  platform: string;
  ok: boolean;
  error?: string;
}

async function invokeWithRetry(
  body: { platform: string; fileUrl: string; fileType: string; caption: string },
): Promise<{ data: any; error: any }> {
  const first = await supabase.functions.invoke('post-telegram', { body });
  // Retry on SDK error (non-2xx) OR on connection reset returned as success:false in body
  if (!first.error && first.data?.success === true) return first;
  await new Promise(r => setTimeout(r, 4000));
  return supabase.functions.invoke('post-telegram', { body });
}

/**
 * Post a single scheduled asset to all its Telegram platforms.
 * Handles compression automatically if the video exceeds Telegram's limit.
 */
export async function postScheduledItem(
  item: ScheduledAsset,
  callbacks: PostItemCallbacks,
): Promise<PostResult[]> {
  const { onStageChange, onCompressionProgress } = callbacks;
  const results: PostResult[] = [];
  const tempR2Keys: string[] = [];

  try {
    const isVideo = item.asset.type === 'VIDEO' || item.asset.type === 'CLIP';
    const hasTelegram = item.platforms.some(p => p.startsWith('telegram'));
    const needsCompression = isVideo && hasTelegram;

    let fileUrl = item.asset.fileUrl;

    if (needsCompression) {
      onStageChange('compressing');
      onCompressionProgress(0);

      const compressed: Blob | null = await compressVideoForTelegram(
        item.asset.fileUrl,
        item.asset.size,
        onCompressionProgress,
      );

      if (compressed) {
        if (isR2Configured()) {
          onStageChange('uploading');
          const tempKey = `compressed/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
          tempR2Keys.push(tempKey);
          fileUrl = await uploadToR2(compressed, tempKey);
        } else {
          console.warn('[telegramPoster] R2 not configured — posting original (may exceed 50 MB limit)');
        }
      }
    }

    onStageChange('posting');

    for (const platform of item.platforms) {
      if (platform === 'x') {
        results.push(await postToX(item));
        continue;
      }

      if (platform === 'website') {
        results.push(await postToWebsite(item, callbacks));
        continue;
      }

      if (!platform.startsWith('telegram')) continue;
      const caption = item.captions[platform] ?? '';
      const fileType = isVideo ? 'video' : 'image';

      const { data, error } = await invokeWithRetry({ platform, fileUrl, fileType, caption });

      // error = SDK-level failure (non-2xx HTTP status, network error)
      // data.success === false = Telegram rejected the post (we return 200 to keep the body readable)
      const ok = !error && data?.success === true;
      const errorMsg = error?.message ?? (data?.error ? `Telegram ${data.tgCode ?? ''}: ${data.error}` : undefined);

      results.push({
        asset: item.asset.name,
        platform,
        ok,
        error: errorMsg,
      });
    }
  } finally {
    onStageChange(null);
    for (const key of tempR2Keys) {
      deleteFromR2(key).catch(() => {});
    }
  }

  return results;
}

/**
 * Post multiple scheduled assets sequentially.
 * Sequential is required: ffmpeg.wasm is a singleton — concurrent exec() calls
 * corrupt its internal state and cause silent failures for all but the first video.
 */
export async function postScheduledItems(
  items: ScheduledAsset[],
  callbacks: PostItemCallbacks,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  for (const item of items) {
    try {
      const r = await postScheduledItem(item, callbacks);
      results.push(...r);
    } catch (err) {
      results.push({
        asset: item.asset.name,
        platform: item.platforms[0] ?? 'unknown',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
