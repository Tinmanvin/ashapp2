import { task } from "@trigger.dev/sdk";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import * as path from "path";

export const compressForWebsite = task({
  id: "compress-for-website",
  // 4K source decode + encode needs real RAM — small-2x (1 GB) OOMs on big files.
  machine: "medium-2x", // 4 GB / 2 vCPU
  maxDuration: 3600,

  run: async (payload: {
    fileUrl: string;
    assetId: string;
    jobId: string;
    rowIds: string[];
    // "website" → target ~85 MB; "telegram" → target ~45 MB (Telegram's 50 MB cap).
    target?: "website" | "telegram";
    // Optional override — multi-video Telegram albums shrink each video so the
    // combined sendMediaGroup request stays under Telegram's ~50 MB request cap.
    targetMb?: number;
  }) => {
    const { fileUrl, assetId, jobId, rowIds } = payload;
    const target = payload.target ?? "website";
    const targetMb = payload.targetMb ?? (target === "telegram" ? 45 : 85);
    // Telegram: better preset + higher bitrate ceiling so short clips keep quality
    // while staying under the 50 MB cap. Website keeps its original tuning.
    const preset = target === "telegram" ? "veryfast" : "ultrafast";
    const maxKbps = target === "telegram" ? 12000 : 2500;

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

      // Calculate the bitrate needed to hit the target size for this platform
      const targetBitrateKbps = calcTargetBitrate(duration, targetMb, maxKbps);

      // Telegram: cap to ~1080p (fit inside 1920x1920). Smaller frames = far less
      // memory (avoids OOM on 4K sources) AND sharper output at the size budget.
      const vf = target === "telegram"
        ? "scale=w=1920:h=1920:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2"
        : "scale=trunc(iw/2)*2:trunc(ih/2)*2";

      // Compress from local file
      await runFFmpeg(inputPath, outputPath, duration, targetBitrateKbps, preset, vf, async (pct) => {
        const mapped = 28 + Math.round(pct * 57); // 28–85%
        await updateJob({ progress: mapped });
      });

      await updateJob({ progress: 90 });

      // Probe the OUTPUT file's display dimensions. Telegram Bot API uploads
      // don't auto-detect dims — iOS/macOS clients render the video card from
      // the message's width/height attributes, so we must supply them or
      // portrait videos stretch. Probing the output (not input) reports
      // whatever FFmpeg actually produced, rotation already baked in.
      const dims = await getVideoDimensions(outputPath).catch(() => null);

      // Upload compressed file to R2 — keyed per platform so website + telegram
      // variants of the same asset never overwrite each other.
      const outputData = await fs.readFile(outputPath);
      const key = `compressed/${target}/${assetId}.mp4`;
      const compressedUrl = await uploadToR2(outputData, key);

      await updateJob({
        progress: 97,
        ...(dims ? { width: dims.width, height: dims.height, duration: dims.duration } : {}),
      });

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

// Calculate bitrate to hit targetMb output. Subtract 128 kbps for audio. Clamp 200..maxKbps.
function calcTargetBitrate(durationSeconds: number, targetMb = 85, maxKbps = 2500): number {
  const totalKbps = Math.floor((targetMb * 1024 * 1024 * 8) / durationSeconds / 1000);
  return Math.max(200, Math.min(maxKbps, totalKbps - 128));
}

// Probe display width/height/duration of a video file. If rotation side data
// survives (±90/270), swap w/h so we always report DISPLAY dimensions.
function getVideoDimensions(
  filePath: string,
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,side_data_list",
      "-show_entries", "format=duration",
      "-of", "json",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const parsed = JSON.parse(out) as {
          streams?: Array<{
            width?: number;
            height?: number;
            side_data_list?: Array<{ rotation?: number }>;
          }>;
          format?: { duration?: string };
        };
        const stream = parsed.streams?.[0];
        if (!stream?.width || !stream?.height) {
          return reject(new Error("ffprobe: no video dimensions found"));
        }
        const rotation = Math.abs(stream.side_data_list?.find((s) => s.rotation != null)?.rotation ?? 0);
        const swap = rotation === 90 || rotation === 270;
        resolve({
          width: swap ? stream.height : stream.width,
          height: swap ? stream.width : stream.height,
          duration: Math.max(1, Math.round(parseFloat(parsed.format?.duration ?? "0") || 0)),
        });
      } catch (err) {
        reject(err);
      }
    });
    proc.on("error", reject);
  });
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
  preset: string,
  vf: string,
  onProgress: (pct: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputUrl,
      "-map_metadata", "0",
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", preset,
      "-b:v", `${targetBitrateKbps}k`,
      "-maxrate", `${targetBitrateKbps * 2}k`,
      "-bufsize", `${targetBitrateKbps * 4}k`,
      "-c:a", "aac",
      "-ar", "44100",
      "-ac", "2",
      "-b:a", "128k",
      // moov atom at the front — required for Telegram Web inline streaming AND
      // for fast metadata reads (browser dimension probe) on remote files.
      "-movflags", "+faststart",
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
