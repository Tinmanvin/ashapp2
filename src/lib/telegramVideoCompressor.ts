import { supabase } from '@/lib/supabase';

/**
 * Server-side (Trigger.dev) video compression for Telegram.
 * Replaces browser FFmpeg — handles any file size, runs off the browser.
 *
 * @param rowIds  scheduled_posts row IDs to auto-update when done (scheduled mode).
 *                Pass [] for "Post Now" mode (caller uses the returned URL directly).
 */
export async function triggerTelegramCompression(
  fileUrl: string,
  assetId: string,
  rowIds: string[] = [],
  targetMb?: number, // smaller for multi-video groups so the album request fits Telegram's ~50 MB cap
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('trigger-compress-telegram', {
    body: { fileUrl, assetId, rowIds, ...(targetMb ? { targetMb } : {}) },
  });

  if (error) throw new Error(`Failed to start compression: ${error.message}`);
  if (!data?.jobId) throw new Error('No jobId returned from compression service');

  return data.jobId as string;
}

export interface CompressionResult {
  url: string;
  // Display dimensions probed server-side (ffprobe) by the compression task.
  // Required by Telegram Bot API or portrait videos stretch on iOS/macOS.
  width: number | null;
  height: number | null;
  duration: number | null;
}

/**
 * Poll a compression job until done or failed.
 * Resolves with the compressed R2 URL + probed dimensions on success.
 */
export async function waitForTelegramCompression(
  jobId: string,
  onProgress: (pct: number) => void,
  intervalMs = 2000,
  maxWaitMs = 15 * 60 * 1000, // give up after 15 min (e.g. a crashed/OOM job)
): Promise<CompressionResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() - started > maxWaitMs) {
        reject(new Error('Compression timed out — the job may have crashed. Try again or check the video size.'));
        return;
      }

      const { data, error } = await supabase
        .from('compression_jobs')
        .select('status, progress, compressed_url, error, width, height, duration')
        .eq('id', jobId)
        .single();

      if (error) { reject(new Error(`Poll failed: ${error.message}`)); return; }

      onProgress(data.progress ?? 0);

      if (data.status === 'done') {
        resolve({
          url: data.compressed_url!,
          width: data.width ?? null,
          height: data.height ?? null,
          duration: data.duration ?? null,
        });
        return;
      }
      if (data.status === 'failed') { reject(new Error(data.error || 'Compression failed')); return; }

      setTimeout(poll, intervalMs);
    };
    poll();
  });
}
