import { supabase } from '@/lib/supabase';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult } from '@/lib/telegramPoster';

export type { PostResult };

export async function postToWebsite(item: ScheduledAsset): Promise<PostResult> {
  const title      = item.asset.name.replace(/\.[^/.]+$/, ''); // strip file extension
  const externalId = `contenthub-${item.asset.id}`;

  const { data, error } = await supabase.functions.invoke('post-website', {
    body: { fileUrl: item.asset.fileUrl, title, externalId },
  });

  const ok       = !error && data?.success === true;
  const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

  return { asset: item.asset.name, platform: 'website', ok, error: errorMsg };
}
