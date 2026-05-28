import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Load single-threaded core from CDN — no SharedArrayBuffer / COEP headers needed
const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

// Telegram Bot API hard limit. We target 45 MB to leave headroom.
export const TELEGRAM_VIDEO_LIMIT = 45 * 1024 * 1024;

// X/Twitter image limit. We trigger compression above 4.5 MB to leave headroom.
export const X_IMAGE_LIMIT = 4.5 * 1024 * 1024;

let instance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getInstance(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ff = new FFmpeg();
    await ff.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    instance = ff;
    return ff;
  })();

  return loadPromise;
}

/**
 * Compress a video so it fits under Telegram's 50 MB limit.
 * Returns null if the file is already small enough.
 *
 * @param fileUrl        Public URL of the source video
 * @param fileSizeBytes  Known byte size (used to skip compression when unnecessary)
 * @param onProgress     Called with 0-100 as ffmpeg processes frames
 */
export async function compressVideoForTelegram(
  fileUrl: string,
  fileSizeBytes: number,
  onProgress: (pct: number) => void,
): Promise<Blob> {
  const ff = await getInstance();

  const handleProgress = ({ progress }: { progress: number }) =>
    onProgress(Math.round(Math.min(progress, 1) * 100));

  ff.on('progress', handleProgress);

  try {
    onProgress(0);
    const inputData = await fetchFile(fileUrl);
    await ff.writeFile('input.mp4', inputData);

    // All videos: transcode to H.264 so HEVC iPhone clips play on Telegram Web Desktop.
    // -movflags +faststart: moov atom at front for streaming.
    // Rotation metadata is preserved (no -map_metadata -1) so portrait clips display correctly.
    // Large videos (>45 MB) get a bitrate cap to fit under the limit.
    const args = [
      '-i', 'input.mp4',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      ...(fileSizeBytes > TELEGRAM_VIDEO_LIMIT ? ['-maxrate', '2500k', '-bufsize', '5000k'] : []),
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      'output.mp4',
    ];

    await ff.exec(args);

    const data = await ff.readFile('output.mp4') as Uint8Array;
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    ff.off('progress', handleProgress);
    await ff.deleteFile('input.mp4').catch(() => {});
    await ff.deleteFile('output.mp4').catch(() => {});
  }
}

/**
 * Compress an image so it fits under X's 5 MB limit.
 * Returns null if the file is already small enough.
 *
 * @param fileUrl        Public URL of the source image
 * @param fileSizeBytes  Known byte size (used to skip when unnecessary)
 */
export async function compressImageForX(
  fileUrl: string,
  fileSizeBytes: number,
): Promise<Blob | null> {
  if (fileSizeBytes <= X_IMAGE_LIMIT) return null;

  const ff = await getInstance();

  try {
    const inputData = await fetchFile(fileUrl);
    await ff.writeFile('input_img', inputData);

    // Re-encode as high-quality JPEG — virtually no visible quality loss
    await ff.exec([
      '-i', 'input_img',
      '-q:v', '3',   // JPEG quality 1–31, lower = better; 3 ≈ 92% quality
      '-y',
      'output_img.jpg',
    ]);

    const data = await ff.readFile('output_img.jpg') as Uint8Array;
    return new Blob([data], { type: 'image/jpeg' });
  } finally {
    await ff.deleteFile('input_img').catch(() => {});
    await ff.deleteFile('output_img.jpg').catch(() => {});
  }
}
