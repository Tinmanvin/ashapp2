import { supabase } from '@/lib/supabase';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult } from '@/lib/telegramPoster';

export type { PostResult };

export async function postToWebsite(item: ScheduledAsset): Promise<PostResult> {
  const cfg = item.websiteConfig;

  const title      = (cfg?.title?.trim() || item.asset.name).replace(/\.[^/.]+$/, '');
  const externalId = `contenthub-${item.asset.id}-${Date.now()}`;
  const categories = cfg?.categories ?? [];
  const tags       = cfg?.tags ?? [];
  const thumbnailUrl = cfg?.thumbnailUrl || item.asset.previewUrl || '';

  const caption = item.captions['website'] ?? '';

  const { data, error } = await supabase.functions.invoke('post-website', {
    body: { fileUrl: item.asset.fileUrl, title, externalId, categories, tags, thumbnailUrl, caption },
  });

  const ok       = !error && data?.success === true;
  const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

  return { asset: item.asset.name, platform: 'website', ok, error: errorMsg };
}
