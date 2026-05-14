/**
 * Shared posting pipeline for Telegram.
 * Used by both "Post Now" (test) and "Publish on Schedule" (production).
 *
 * Flow for videos over the Telegram limit:
 *   compress in browser → upload compressed blob to R2 → call edge function → delete temp file
 */

import { supabase } from '@/lib/supabase';
import { uploadToR2, deleteFromR2, isR2Configured } from '@/lib/r2';
import { compressVideoForTelegram, TELEGRAM_VIDEO_LIMIT } from '@/lib/videoCompressor';
import { postToX } from '@/lib/xPoster';
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
    const isVideo = item.asset.type === 'VIDEO';
    const needsCompression = isVideo && item.asset.size > TELEGRAM_VIDEO_LIMIT;

    let fileUrl = item.asset.fileUrl;

    if (needsCompression) {
      onStageChange('compressing');
      onCompressionProgress(0);

      const compressed = await compressVideoForTelegram(
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

      if (!platform.startsWith('telegram')) continue;
      const caption = item.captions[platform] ?? '';
      const fileType = isVideo ? 'video' : 'image';

      const { data, error } = await supabase.functions.invoke('post-telegram', {
        body: { platform, fileUrl, fileType, caption },
      });

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
 * Post multiple scheduled assets in sequence.
 * Returns all results aggregated.
 */
export async function postScheduledItems(
  items: ScheduledAsset[],
  callbacks: PostItemCallbacks,
): Promise<PostResult[]> {
  const allResults: PostResult[] = [];
  for (const item of items) {
    const results = await postScheduledItem(item, callbacks);
    allResults.push(...results);
  }
  return allResults;
}
