import { supabase } from '@/lib/supabase';
import { uploadToR2, deleteFromR2, isR2Configured } from '@/lib/r2';
import { compressImageForX, X_IMAGE_LIMIT } from '@/lib/videoCompressor';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult } from '@/lib/telegramPoster';

export type { PostResult };

export async function postToX(item: ScheduledAsset): Promise<PostResult> {
  const caption  = item.captions['x'] ?? '';
  const fileType = item.asset.type === 'VIDEO' ? 'video' : 'image';
  let fileUrl    = item.asset.fileUrl;
  let tempR2Key: string | null = null;

  try {
    if (fileType === 'image' && item.asset.size > X_IMAGE_LIMIT) {
      const compressed = await compressImageForX(fileUrl, item.asset.size);
      if (compressed && isR2Configured()) {
        tempR2Key = `compressed/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        fileUrl   = await uploadToR2(compressed, tempR2Key);
      }
    }

    const { data, error } = await supabase.functions.invoke('post-x', {
      body: { fileUrl, fileType, caption },
    });

    const ok       = !error && data?.success === true;
    const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

    return { asset: item.asset.name, platform: 'x', ok, error: errorMsg };
  } finally {
    if (tempR2Key) deleteFromR2(tempR2Key).catch(() => {});
  }
}
