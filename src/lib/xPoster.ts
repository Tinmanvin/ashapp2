import { supabase } from '@/lib/supabase';
import { uploadToR2, deleteFromR2, isR2Configured } from '@/lib/r2';
import { compressImageForX, X_IMAGE_LIMIT } from '@/lib/videoCompressor';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult } from '@/lib/telegramPoster';

export type { PostResult };

/**
 * Post a group (or single) to X.
 * - 1 asset  → one photo/video tweet (unchanged behaviour).
 * - 2+ assets → one multi-image tweet (images only, max 4 — enforced in the UI).
 */
export async function postToX(item: ScheduledAsset): Promise<PostResult> {
  const caption   = item.captions['x'] ?? '';
  const assetName = item.assets[0]?.name ?? 'unknown';
  const tempR2Keys: string[] = [];

  try {
    const items: { fileUrl: string; fileType: 'image' | 'video' }[] = [];

    for (const asset of item.assets) {
      const fileType: 'image' | 'video' =
        asset.type === 'VIDEO' || asset.type === 'CLIP' ? 'video' : 'image';
      let fileUrl = asset.fileUrl;

      if (fileType === 'image' && asset.size > X_IMAGE_LIMIT) {
        const compressed = await compressImageForX(fileUrl, asset.size);
        if (compressed && isR2Configured()) {
          const key = `compressed/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          tempR2Keys.push(key);
          fileUrl = await uploadToR2(compressed, key);
        }
      }

      items.push({ fileUrl, fileType });
    }

    const { data, error } = await supabase.functions.invoke('post-x', {
      body: { items, caption },
    });

    const ok       = !error && data?.success === true;
    const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

    return { asset: assetName, platform: 'x', ok, error: errorMsg };
  } finally {
    for (const key of tempR2Keys) deleteFromR2(key).catch(() => {});
  }
}
