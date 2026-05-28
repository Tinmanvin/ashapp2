/**
 * Probe a video's true display dimensions and duration in the browser.
 * Uses HTML5 video element — only reads the file header, very fast (~50ms).
 *
 * videoWidth / videoHeight return the DISPLAY dimensions (post-rotation),
 * which is what Telegram needs to render portrait iPhone videos correctly.
 */
export interface VideoDimensions {
  width: number;
  height: number;
  duration: number;
}

export function probeVideoDimensions(url: string): Promise<VideoDimensions | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.src = '';
    };

    const timeout = setTimeout(() => {
      console.warn('[videoProbe] timeout reading metadata for', url);
      cleanup();
      resolve(null);
    }, 10_000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      const dims: VideoDimensions = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Math.max(1, Math.round(video.duration || 0)),
      };
      console.log('[videoProbe]', url.split('/').pop(), dims);
      cleanup();
      resolve(dims);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      console.warn('[videoProbe] error reading metadata for', url);
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}
