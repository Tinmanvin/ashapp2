/**
 * Shared posting pipeline. Used by "Post Now".
 *
 * A post is ALWAYS a "group of N":
 *   - assets.length === 1 → single sendPhoto/sendVideo.
 *   - assets.length  >  1 → native album via sendMediaGroup.
 *
 * Telegram videos are compressed SERVER-SIDE via Trigger.dev (handles any size,
 * runs off the browser). We enqueue the job, poll it, then post the result.
 */

import { postToX } from '@/lib/xPoster';
import { postToWebsite } from '@/lib/websitePoster';
import { triggerTelegramCompression, waitForTelegramCompression } from '@/lib/telegramVideoCompressor';
import { probeVideoDimensions } from '@/lib/videoProbe';
import { supabase } from '@/lib/supabase';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { UploadedAsset } from '@/hooks/useFileUpload';

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

interface TelegramMediaItem {
  fileUrl: string;
  fileType: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
}

type TelegramBody =
  | { platform: string; caption: string; fileUrl: string; fileType: 'image' | 'video'; width?: number; height?: number; duration?: number }
  | { platform: string; caption: string; items: TelegramMediaItem[] };

async function invokeWithRetry(body: TelegramBody): Promise<{ data: { success?: boolean; error?: string; tgCode?: number } | null; error: { message: string } | null }> {
  const first = await supabase.functions.invoke('post-telegram', { body });
  if (!first.error && first.data?.success === true) return first;
  await new Promise(r => setTimeout(r, 4000));
  return supabase.functions.invoke('post-telegram', { body });
}

function isVideoAsset(asset: UploadedAsset): boolean {
  return asset.type === 'VIDEO' || asset.type === 'CLIP';
}

/**
 * Post a single grouped item to all its platforms.
 * Telegram media is prepared once (server-side compress per video) and reused
 * across every Telegram channel in the post.
 */
export async function postScheduledItem(
  item: ScheduledAsset,
  callbacks: PostItemCallbacks,
): Promise<PostResult[]> {
  const { onStageChange, onCompressionProgress } = callbacks;
  const results: PostResult[] = [];
  const label = item.assets[0]?.name ?? 'unknown';

  try {
    const telegramPlatforms = item.platforms.filter(p => p.startsWith('telegram'));

    // Multi-video albums must share Telegram's ~50 MB request cap, so shrink each.
    const videoCount = item.assets.filter(isVideoAsset).length;
    const perVideoTargetMb = videoCount > 1 ? Math.max(8, Math.floor(42 / videoCount)) : 45;

    // ── Prepare Telegram media (videos compressed server-side, sequentially) ──
    const tgMedia: TelegramMediaItem[] = [];
    if (telegramPlatforms.length > 0) {
      for (const asset of item.assets) {
        if (!isVideoAsset(asset)) {
          tgMedia.push({ fileUrl: asset.fileUrl, fileType: 'image' });
          continue;
        }

        onStageChange('compressing');
        onCompressionProgress(0);

        // Server-side FFmpeg (Trigger.dev) — no browser memory limits.
        const jobId = await triggerTelegramCompression(asset.fileUrl, asset.id, [], perVideoTargetMb);
        const compressedUrl = await waitForTelegramCompression(jobId, onCompressionProgress);

        // Probe the compressed file's dimensions for correct Telegram rendering.
        const dims = await probeVideoDimensions(compressedUrl);
        tgMedia.push({
          fileUrl: compressedUrl,
          fileType: 'video',
          ...(dims ? { width: dims.width, height: dims.height, duration: dims.duration } : {}),
        });
      }
    }

    onStageChange('posting');

    for (const platform of item.platforms) {
      if (platform === 'x') { results.push(await postToX(item)); continue; }
      if (platform === 'website') { results.push(await postToWebsite(item, callbacks)); continue; }
      if (!platform.startsWith('telegram')) continue;

      const caption = item.captions[platform] ?? '';
      const body: TelegramBody = tgMedia.length >= 2
        ? { platform, caption, items: tgMedia }
        : {
            platform,
            caption,
            fileUrl: tgMedia[0].fileUrl,
            fileType: tgMedia[0].fileType,
            ...(tgMedia[0].width  ? { width: tgMedia[0].width }   : {}),
            ...(tgMedia[0].height ? { height: tgMedia[0].height } : {}),
            ...(tgMedia[0].duration ? { duration: tgMedia[0].duration } : {}),
          };

      const { data, error } = await invokeWithRetry(body);
      const ok = !error && data?.success === true;
      const errorMsg = error?.message ?? (data?.error ? `Telegram ${data.tgCode ?? ''}: ${data.error}` : undefined);

      results.push({ asset: label, platform, ok, error: errorMsg });
    }
  } finally {
    onStageChange(null);
  }

  return results;
}

/**
 * Post multiple grouped items sequentially.
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
        asset: item.assets[0]?.name ?? 'unknown',
        platform: item.platforms[0] ?? 'unknown',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
