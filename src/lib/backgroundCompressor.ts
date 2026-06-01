import { supabase } from '@/lib/supabase';
import { uploadToR2, isR2Configured } from '@/lib/r2';
import { compressImageForX, X_IMAGE_LIMIT } from '@/lib/videoCompressor';
import { triggerTelegramCompression } from '@/lib/telegramVideoCompressor';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { UploadedAsset } from '@/hooks/useFileUpload';

interface InsertedRow {
  id: string;
  asset_id: string;
  platform: string;
}

/**
 * Fire-and-forget background compression for scheduled posts.
 * Runs after "Publish on Schedule" saves rows to Supabase.
 *
 *  - Telegram videos → enqueued to the SERVER (Trigger.dev). The task compresses
 *    and updates the rows' file_url when done; the cron waits for it before posting.
 *  - X images > 4.5 MB → compressed in-browser (fast canvas re-encode).
 *
 * Group-aware: a post can contain multiple assets — each is handled in turn.
 */
export function scheduleBackgroundCompression(
  items: ScheduledAsset[],
  insertedRows: InsertedRow[],
): void {
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

  for (const item of items) {
    // Multi-video albums share Telegram's ~50 MB request cap, so shrink each.
    const videoCount = item.assets.filter((a) => a.type === 'VIDEO' || a.type === 'CLIP').length;
    const perVideoTargetMb = videoCount > 1 ? Math.max(8, Math.floor(42 / videoCount)) : 45;
    for (const asset of item.assets) {
      await handleAsset(asset, item.platforms, rowLookup.get(asset.id) ?? new Map(), perVideoTargetMb).catch((err) => {
        console.error(`[backgroundCompressor] Failed for "${asset.name}":`, err);
      });
    }
  }
}

async function handleAsset(
  asset: UploadedAsset,
  platforms: string[],
  platformRows: Map<string, string[]>,
  perVideoTargetMb: number,
): Promise<void> {
  const isVideo = asset.type === 'VIDEO' || asset.type === 'CLIP';
  const telegramPlatforms = platforms.filter((p) => p.startsWith('telegram'));
  const hasX = platforms.includes('x');

  // ── Telegram video → server-side compression (Trigger.dev) ───────────────────
  if (isVideo && telegramPlatforms.length > 0) {
    const tgRowIds = telegramPlatforms.flatMap((p) => platformRows.get(p) ?? []);
    try {
      // Fire-and-forget enqueue — the task updates these rows' file_url when done.
      await triggerTelegramCompression(asset.fileUrl, asset.id, tgRowIds, perVideoTargetMb);
    } catch (err) {
      console.error('[backgroundCompressor] Telegram enqueue error:', err);
    }
  }

  // ── X image > 4.5 MB → fast browser compression ──────────────────────────────
  if (!isVideo && hasX && asset.size > X_IMAGE_LIMIT && isR2Configured()) {
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
      console.error('[backgroundCompressor] X image compression error:', err);
    }
  }
}
