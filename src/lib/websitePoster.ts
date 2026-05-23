import { supabase } from '@/lib/supabase';
import type { ScheduledAsset } from '@/store/schedulerStore';
import type { PostResult, PostItemCallbacks } from '@/lib/telegramPoster';
import {
  WEBSITE_VIDEO_LIMIT,
  triggerWebsiteCompression,
  waitForWebsiteCompression,
} from '@/lib/websiteCompressor';

export type { PostResult };

export async function postToWebsite(
  item: ScheduledAsset,
  callbacks?: PostItemCallbacks,
): Promise<PostResult> {
  const cfg = item.websiteConfig;

  const title      = (cfg?.title?.trim() || item.asset.name).replace(/\.[^/.]+$/, '');
  const externalId = `contenthub-${item.asset.id}-${Date.now()}`;
  const categories = cfg?.categories ?? [];
  const tags       = cfg?.tags ?? [];
  // Scheduler items snapshot the asset at queue time, so previewUrl may be a
  // data: URL (optimistic thumbnail) if the user queued the asset before the
  // R2 upload finished. Always resolve to an https:// URL — fall back to a
  // fresh DB read if neither the config nor the snapshot is a public URL.
  const snapshotUrl = [cfg?.thumbnailUrl, item.asset.previewUrl].find(u => u?.startsWith('https://'));
  let thumbnailUrl = snapshotUrl ?? '';
  if (!thumbnailUrl) {
    const { data: assetRow } = await supabase
      .from('assets')
      .select('thumbnail_url')
      .eq('id', item.asset.id)
      .maybeSingle();
    thumbnailUrl = assetRow?.thumbnail_url ?? '';
  }

  // Fetch fresh from Supabase — queue item captions can be stale
  const { data: captionRow } = await supabase
    .from('captions')
    .select('body')
    .eq('asset_id', item.asset.id)
    .eq('platform', 'website')
    .maybeSingle();
  const caption = captionRow?.body || item.captions['website'] || '';

  // Compress large videos server-side before posting (Cloudflare upload limit ~100 MB)
  const isVideo = item.asset.type === 'VIDEO' || item.asset.type === 'CLIP';
  let fileUrl = item.asset.fileUrl;
  if (isVideo && item.asset.size > WEBSITE_VIDEO_LIMIT && callbacks) {
    callbacks.onStageChange('compressing');
    callbacks.onCompressionProgress(0);
    const jobId = await triggerWebsiteCompression(fileUrl, item.asset.id);
    fileUrl = await waitForWebsiteCompression(jobId, callbacks.onCompressionProgress);
    callbacks.onStageChange('posting');
  }

  const { data, error } = await supabase.functions.invoke('post-website', {
    body: { fileUrl, title, externalId, categories, tags, thumbnailUrl, caption },
  });

  const ok       = !error && data?.success === true;
  const errorMsg = error?.message ?? (data?.error ? String(data.error) : undefined);

  return { asset: item.asset.name, platform: 'website', ok, error: errorMsg };
}
