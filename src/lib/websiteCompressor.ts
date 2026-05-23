import { supabase } from '@/lib/supabase';

// Cloudflare proxied upload limit on blackmagicmodel.com — compress anything over this
export const WEBSITE_VIDEO_LIMIT = 90 * 1024 * 1024; // 90 MB

/**
 * Kick off server-side FFmpeg compression for a website video.
 * Returns a jobId to poll for progress via waitForWebsiteCompression().
 *
 * @param rowIds  scheduled_posts row IDs to auto-update when done (scheduled mode).
 *                Pass [] for "Post Now" mode.
 */
export async function triggerWebsiteCompression(
  fileUrl: string,
  assetId: string,
  rowIds: string[] = [],
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('trigger-compress-website', {
    body: { fileUrl, assetId, rowIds },
  });

  if (error) throw new Error(`Failed to start compression: ${error.message}`);
  if (!data?.jobId) throw new Error('No jobId returned from compression service');

  return data.jobId as string;
}

/**
 * Poll a compression job until done or failed.
 * Resolves with the compressed R2 URL on success.
 */
export async function waitForWebsiteCompression(
  jobId: string,
  onProgress: (pct: number) => void,
  intervalMs = 2000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      const { data, error } = await supabase
        .from('compression_jobs')
        .select('status, progress, compressed_url, error')
        .eq('id', jobId)
        .single();

      if (error) {
        reject(new Error(`Poll failed: ${error.message}`));
        return;
      }

      onProgress(data.progress ?? 0);

      if (data.status === 'done') {
        resolve(data.compressed_url!);
        return;
      }

      if (data.status === 'failed') {
        reject(new Error(data.error || 'Compression failed'));
        return;
      }

      setTimeout(poll, intervalMs);
    };

    poll();
  });
}
