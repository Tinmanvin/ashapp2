import { supabase } from '@/lib/supabase';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult } from '@/lib/telegramPoster';

export type { PostResult };

export async function postToX(item: ScheduledAsset): Promise<PostResult> {
  const caption  = item.captions['x'] ?? '';
  const fileUrl  = item.asset.fileUrl;
  const fileType = item.asset.type === 'VIDEO' ? 'video' : 'image';

  const { data, error } = await supabase.functions.invoke('post-x', {
    body: { fileUrl, fileType, caption },
  });

  const ok       = !error && data?.success === true;
  const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

  return { asset: item.asset.name, platform: 'x', ok, error: errorMsg };
}
