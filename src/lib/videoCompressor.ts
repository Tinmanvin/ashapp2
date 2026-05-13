import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Load single-threaded core from CDN — no SharedArrayBuffer / COEP headers needed
const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

// Telegram Bot API hard limit. We target 45 MB to leave headroom.
export const TELEGRAM_VIDEO_LIMIT = 45 * 1024 * 1024;

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
): Promise<Blob | null> {
  if (fileSizeBytes <= TELEGRAM_VIDEO_LIMIT) return null;

  const ff = await getInstance();

  const handleProgress = ({ progress }: { progress: number }) =>
    onProgress(Math.round(Math.min(progress, 1) * 100));

  ff.on('progress', handleProgress);

  try {
    onProgress(0);
    const inputData = await fetchFile(fileUrl);
    await ff.writeFile('input.mp4', inputData);

    // CRF 28 + 4 Mbps cap: typically compresses a 100 MB clip to 15–35 MB.
    // We don't bother scaling resolution — Telegram re-compresses everything anyway.
    await ff.exec([
      '-i', 'input.mp4',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-y',
      'output.mp4',
    ]);

    const data = await ff.readFile('output.mp4') as Uint8Array;
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    ff.off('progress', handleProgress);
    await ff.deleteFile('input.mp4').catch(() => {});
    await ff.deleteFile('output.mp4').catch(() => {});
  }
}
