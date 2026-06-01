import { supabase } from '@/lib/supabase';
import { uploadToR2, isR2Configured } from '@/lib/r2';
import {
  compressVideoForTelegram,
  compressImageForX,
  X_IMAGE_LIMIT,
} from '@/lib/videoCompressor';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { UploadedAsset } from '@/hooks/useFileUpload';

interface InsertedRow {
  id: string;
  asset_id: string;
  platform: string;
}

/**
 * Fire-and-forget: compress videos/images for scheduled posts in the background.
 * Runs silently after "Publish on Schedule" saves rows to Supabase.
 * Updates file_url in the DB once compression + R2 upload finishes.
 *
 * Group-aware: a post can contain multiple assets — each is compressed in turn.
 */
export function scheduleBackgroundCompression(
  items: ScheduledAsset[],
  insertedRows: InsertedRow[],
): void {
  if (!isR2Configured()) return;
  runCompression(items, insertedRows).catch((err) => {
    console.error('[backgroundCompressor] Unexpected error:', err);
  });
}

async function runCompression(
  items: ScheduledAsset[],
  insertedRows: InsertedRow[],
): Promise<void> {
  // Build lookup: asset_id → platform → row ids
  const rowLookup = new Map<string, Map<string, string[]>>();
  for (const row of insertedRows) {
    if (!rowLookup.has(row.asset_id)) rowLookup.set(row.asset_id, new Map());
    const byPlatform = rowLookup.get(row.asset_id)!;
    if (!byPlatform.has(row.platform)) byPlatform.set(row.platform, []);
    byPlatform.get(row.platform)!.push(row.id);
  }

  // Sequential — FFmpeg WASM is a singleton; concurrent exec() calls corrupt state.
  for (const item of items) {
    for (const asset of item.assets) {
      await compressAsset(asset, item.platforms, rowLookup.get(asset.id) ?? new Map()).catch((err) => {
        console.error(`[backgroundCompressor] Failed for "${asset.name}":`, err);
      });
    }
  }
}

async function compressAsset(
  asset: UploadedAsset,
  platforms: string[],
  platformRows: Map<string, string[]>,
): Promise<void> {
  const isVideo = asset.type === 'VIDEO' || asset.type === 'CLIP';
  const telegramPlatforms = platforms.filter((p) => p.startsWith('telegram'));
  const hasX = platforms.includes('x');

  // ── Telegram: transcode all videos — H.264 + faststart for HEVC compatibility ──
  if (isVideo && telegramPlatforms.length > 0) {
    const key = `compressed/telegram/${asset.id}.mp4`;
    try {
      const compressed = await compressVideoForTelegram(asset.fileUrl, asset.size, () => {});
      if (compressed) {
        const compressedUrl = await uploadToR2(compressed, key);
        const rowIds = telegramPlatforms.flatMap((p) => platformRows.get(p) ?? []);
        if (rowIds.length > 0) {
          await supabase.from('scheduled_posts').update({ file_url: compressedUrl }).in('id', rowIds);
        }
      }
    } catch (err) {
      console.error(`[backgroundCompressor] Telegram video compression error:`, err);
    }
  }

  // ── X: compress image over 4.5 MB ────────────────────────────────────────────
  if (!isVideo && hasX && asset.size > X_IMAGE_LIMIT) {
    const key = `compressed/x/${asset.id}.jpg`;
    try {
      const compressed = await compressImageForX(asset.fileUrl, asset.size);
      if (compressed) {
        const compressedUrl = await uploadToR2(compressed, key);
        const rowIds = platformRows.get('x') ?? [];
        if (rowIds.length > 0) {
          await supabase.from('scheduled_posts').update({ file_url: compressedUrl }).in('id', rowIds);
        }
      }
    } catch (err) {
      console.error(`[backgroundCompressor] X image compression error:`, err);
    }
  }
}
