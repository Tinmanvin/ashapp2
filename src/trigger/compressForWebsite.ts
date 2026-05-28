import { task } from "@trigger.dev/sdk";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import * as path from "path";

export const compressForWebsite = task({
  id: "compress-for-website",
  machine: "small-2x",
  maxDuration: 3600,

  run: async (payload: {
    fileUrl: string;
    assetId: string;
    jobId: string;
    rowIds: string[];
  }) => {
    const { fileUrl, assetId, jobId, rowIds } = payload;

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const updateJob = (fields: Record<string, unknown>) =>
      supabase.from("compression_jobs").update(fields).eq("id", jobId);

    await updateJob({ status: "running", progress: 0 });

    const tmpDir = `/tmp/compress-${jobId}`;
    await fs.mkdir(tmpDir, { recursive: true });
    const inputPath = path.join(tmpDir, "input.mp4");
    const outputPath = path.join(tmpDir, "output.mp4");

    try {
      // Download to /tmp first so FFmpeg works on a local file (no moov-atom seek issue)
      await downloadFile(fileUrl, inputPath, async (pct) => {
        const mapped = Math.round(pct * 25); // 0–25%
        await updateJob({ progress: mapped });
      });

      // Get video duration so we can calculate target bitrate + track progress
      const duration = await getVideoDuration(inputPath);
      await updateJob({ progress: 28 });

      // Target 85 MB: calculate the bitrate needed to hit that size
      const targetBitrateKbps = calcTargetBitrate(duration);

      // Compress from local file
      await runFFmpeg(inputPath, outputPath, duration, targetBitrateKbps, async (pct) => {
        const mapped = 28 + Math.round(pct * 57); // 28–85%
        await updateJob({ progress: mapped });
      });

      await updateJob({ progress: 90 });

      // Upload compressed file to R2
      const outputData = await fs.readFile(outputPath);
      const key = `compressed/website/${assetId}.mp4`;
      const compressedUrl = await uploadToR2(outputData, key);

      await updateJob({ progress: 97 });

      // For scheduled mode: update the scheduled_posts rows with the compressed URL
      if (rowIds.length > 0) {
        await supabase
          .from("scheduled_posts")
          .update({ file_url: compressedUrl })
          .in("id", rowIds);
      }

      await updateJob({ status: "done", progress: 100, compressed_url: compressedUrl });
      return { compressedUrl };
    } catch (err) {
      await updateJob({ status: "failed", error: String(err) });
      throw err;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});

async function downloadFile(
  url: string,
  dest: string,
  onProgress: (pct: number) => Promise<void>,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  const writer = await fs.open(dest, "w");
  let downloaded = 0;
  let lastPct = -1;

  try {
    const reader = res.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      downloaded += value.length;
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100);
        if (pct > lastPct) {
          lastPct = pct;
          await onProgress(pct / 100);
        }
      }
    }
  } finally {
    await writer.close();
  }
}

// Target 85 MB output. Subtract 128 kbps for audio. Clamp 200–2500 kbps.
function calcTargetBitrate(durationSeconds: number): number {
  const totalKbps = Math.floor((85 * 1024 * 1024 * 8) / durationSeconds / 1000);
  return Math.max(200, Math.min(2500, totalKbps - 128));
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      url,
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      const secs = parseFloat(out.trim());
      if (!isFinite(secs)) return reject(new Error("ffprobe: could not parse duration"));
      resolve(secs);
    });
    proc.on("error", reject);
  });
}

function runFFmpeg(
  inputUrl: string,
  outputPath: string,
  durationSeconds: number,
  targetBitrateKbps: number,
  onProgress: (pct: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputUrl,
      "-map_metadata", "0",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-b:v", `${targetBitrateKbps}k`,
      "-maxrate", `${targetBitrateKbps * 2}k`,
      "-bufsize", `${targetBitrateKbps * 4}k`,
      "-c:a", "aac",
      "-ar", "44100",
      "-ac", "2",
      "-b:a", "128k",
      "-progress", "pipe:1",
      "-y",
      outputPath,
    ]);

    let lastPct = 0;
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/out_time_ms=(\d+)/);
      if (match) {
        const elapsed = parseInt(match[1], 10) / 1_000_000;
        const pct = Math.min(1, elapsed / durationSeconds);
        const pctInt = Math.round(pct * 100);
        if (pctInt > lastPct) {
          lastPct = pctInt;
          onProgress(pct).catch(() => {});
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

async function uploadToR2(data: Buffer, key: string): Promise<string> {
  const workerUrl = process.env.R2_WORKER_URL!;
  const secret = process.env.R2_UPLOAD_SECRET!;

  if (data.length <= 50 * 1024 * 1024) {
    const form = new FormData();
    form.append("file", new Blob([data], { type: "video/mp4" }), key.split("/").pop()!);
    form.append("key", key);

    const res = await fetch(`${workerUrl}/upload/small`, {
      method: "POST",
      headers: { "X-Upload-Secret": secret },
      body: form,
    });
    if (!res.ok) throw new Error(`R2 small upload failed (${res.status}): ${await res.text()}`);
    const { url } = await res.json() as { url: string };
    return url;
  }

  // Large: presigned PUT
  const presignRes = await fetch(`${workerUrl}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Upload-Secret": secret },
    body: JSON.stringify({ key, contentType: "video/mp4" }),
  });
  if (!presignRes.ok) {
    throw new Error(`R2 presign failed (${presignRes.status}): ${await presignRes.text()}`);
  }

  const { presignedUrl, publicUrl } = await presignRes.json() as {
    presignedUrl: string;
    publicUrl: string;
  };

  const putRes = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(data.length) },
    body: data,
  });
  if (!putRes.ok) throw new Error(`R2 PUT failed (${putRes.status}): ${await putRes.text()}`);

  return publicUrl;
}
