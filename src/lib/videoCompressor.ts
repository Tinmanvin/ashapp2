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

// Probe the input file and return codec + rotation.
async function detectVideoInfo(ff: FFmpeg, inputFile: string): Promise<{ rotation: number; isHevc: boolean }> {
  const lines: string[] = [];
  const handler = ({ message }: { type: string; message: string }) => lines.push(message);
  ff.on('log', handler);
  try { await ff.exec(['-i', inputFile]); } catch (_) {}
  ff.off('log', handler);

  const text = lines.join('\n');
  const rotMatch = text.match(/rotate\s*:\s*(-?\d+)/i);
  const rotation = rotMatch ? ((parseInt(rotMatch[1]) % 360) + 360) % 360 : 0;
  const isHevc = /Video:\s*hevc/i.test(text);

  console.log('[compressor] isHevc:', isHevc, 'rotation:', rotation);
  return { rotation, isHevc };
}

function buildVfFilter(rotation: number): string {
  const evenScale = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  if (rotation === 90)  return `transpose=2,${evenScale}`;  // 90° CCW
  if (rotation === 270) return `transpose=1,${evenScale}`;  // 90° CW
  if (rotation === 180) return `hflip,vflip,${evenScale}`;
  return evenScale;
}

/**
 * Compress / transcode a video for Telegram.
 * Returns null when no processing is needed (H.264 already, under size limit).
 *
 * Only transcodes when:
 *   - Video is HEVC (needs H.264 for Telegram Web Desktop), OR
 *   - Video is over 45 MB (needs bitrate reduction)
 *
 * @param fileUrl        Public URL of the source video
 * @param fileSizeBytes  Known byte size
 * @param onProgress     Called with 0-100 as ffmpeg processes frames
 */
export async function compressVideoForTelegram(
  fileUrl: string,
  fileSizeBytes: number,
  onProgress: (pct: number) => void,
): Promise<Blob | null> {
  const ff = await getInstance();

  const handleProgress = ({ progress }: { progress: number }) =>
    onProgress(Math.round(Math.min(progress, 1) * 100));

  ff.on('progress', handleProgress);

  try {
    onProgress(0);
    const inputData = await fetchFile(fileUrl);
    await ff.writeFile('input.mp4', inputData);

    const { rotation, isHevc } = await detectVideoInfo(ff, 'input.mp4');

    // H.264 under the size limit: already in the right format, send as-is.
    // Running it through ffmpeg re-encodes unnecessarily and can break orientation.
    if (!isHevc && fileSizeBytes <= TELEGRAM_VIDEO_LIMIT) {
      console.log('[compressor] H.264 under limit — skipping transcode');
      return null;
    }

    const vfFilter = buildVfFilter(rotation);
    console.log('[compressor] vf filter:', vfFilter);

    // -noautorotate: we apply rotation explicitly via vf to avoid double-rotation.
    // -metadata:s:v:0 rotate=0: clear the rotation tag since we've baked it into pixels.
    // -profile:v baseline: required for Telegram Web inline playback.
    // -movflags +faststart: moov atom at front for streaming.
    const args = [
      '-noautorotate',
      '-i', 'input.mp4',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-profile:v', 'baseline',
      '-crf', '28',
      '-vf', vfFilter,
      '-pix_fmt', 'yuv420p',
      '-metadata:s:v:0', 'rotate=0',
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
    console.log(`[compressor] output size: ${data.byteLength} bytes (input was ${fileSizeBytes} bytes)`);
    if (data.byteLength < 10000) {
      throw new Error(`ffmpeg output too small (${data.byteLength} bytes) — transcode likely failed silently`);
    }
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

    await ff.exec([
      '-i', 'input_img',
      '-q:v', '3',
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
