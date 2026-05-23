import { supabase } from '@/lib/supabase';
import { uploadToR2, isR2Configured } from '@/lib/r2';
import {
  compressVideoForTelegram,
  compressImageForX,
  TELEGRAM_VIDEO_LIMIT,
  X_IMAGE_LIMIT,
} from '@/lib/videoCompressor';
import { WEBSITE_VIDEO_LIMIT, triggerWebsiteCompression } from '@/lib/websiteCompressor';
import type { ScheduledAsset } from '@/store/schedulerStore';

interface InsertedRow {
  id: string;
  asset_id: string;
  platform: string;
}

/**
 * Fire-and-forget: compress videos/images for scheduled posts in the background.
 * Runs silently after "Publish on Schedule" saves rows to Supabase.
 * Updates file_url in the DB once compression + R2 upload finishes.
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

  // Sequential — FFmpeg WASM is a singleton; concurrent exec() calls corrupt state
  for (const item of items) {
    await compressItem(item, rowLookup.get(item.asset.id) ?? new Map()).catch((err) => {
      console.error(`[backgroundCompressor] Failed for "${item.asset.name}":`, err);
    });
  }
}

async function compressItem(
  item: ScheduledAsset,
  platformRows: Map<string, string[]>,
): Promise<void> {
  const isVideo = item.asset.type === 'VIDEO' || item.asset.type === 'CLIP';
  const telegramPlatforms = item.platforms.filter((p) => p.startsWith('telegram'));
  const hasX = item.platforms.includes('x');

  // ── Telegram: compress video over 45 MB ──────────────────────────────────────
  if (isVideo && telegramPlatforms.length > 0 && item.asset.size > TELEGRAM_VIDEO_LIMIT) {
    const key = `compressed/telegram/${item.asset.id}.mp4`;
    try {
      const compressed = await compressVideoForTelegram(
        item.asset.fileUrl,
        item.asset.size,
        () => {}, // silent — no progress UI
      );
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

  // ── Website: compress video over 90 MB server-side via Trigger.dev ──────────
  const hasWebsite = item.platforms.includes('website');
  if (isVideo && hasWebsite && item.asset.size > WEBSITE_VIDEO_LIMIT) {
    const rowIds = platformRows.get('website') ?? [];
    if (rowIds.length > 0) {
      triggerWebsiteCompression(item.asset.fileUrl, item.asset.id, rowIds).catch((err) => {
        console.error(`[backgroundCompressor] Website compression trigger failed:`, err);
      });
    }
  }

  // ── X: compress image over 4.5 MB ────────────────────────────────────────────
  if (!isVideo && hasX && item.asset.size > X_IMAGE_LIMIT) {
    const key = `compressed/x/${item.asset.id}.jpg`;
    try {
      const compressed = await compressImageForX(item.asset.fileUrl, item.asset.size);
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
