import { supabase } from '@/lib/supabase';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult, PostItemCallbacks } from '@/lib/telegramPoster';

export type { PostResult };

export async function postToWebsite(
  item: ScheduledAsset,
  _callbacks?: PostItemCallbacks,
): Promise<PostResult> {
  const cfg = item.websiteConfig;

  // Website is a single-item funnel — a grouped post publishes its cover asset.
  const asset = item.assets[0];

  const title      = (cfg?.title?.trim() || asset.name).replace(/\.[^/.]+$/, '');
  const externalId = `contenthub-${asset.id}-${Date.now()}`;
  const categories = cfg?.categories ?? [];
  const tags       = cfg?.tags ?? [];
  const snapshotUrl = [cfg?.thumbnailUrl, asset.previewUrl].find(u => u?.startsWith('https://'));
  let thumbnailUrl = snapshotUrl ?? '';
  if (!thumbnailUrl) {
    const { data: assetRow } = await supabase
      .from('assets')
      .select('thumbnail_url')
      .eq('id', asset.id)
      .maybeSingle();
    thumbnailUrl = assetRow?.thumbnail_url ?? '';
  }

  // Fetch fresh from Supabase — queue item captions can be stale
  const { data: captionRow } = await supabase
    .from('captions')
    .select('body')
    .eq('asset_id', asset.id)
    .eq('platform', 'website')
    .maybeSingle();
  const caption = captionRow?.body || item.captions['website'] || '';

  const { data, error } = await supabase.functions.invoke('post-website', {
    body: { fileUrl: asset.fileUrl, title, externalId, categories, tags, thumbnailUrl, caption },
  });

  const ok       = !error && data?.success === true;
  const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

  return { asset: asset.name, platform: 'website', ok, error: errorMsg };
}
