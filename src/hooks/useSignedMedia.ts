import { useEffect, useState } from 'react';
import { mediaKey, signMediaUrl, signMediaUrls, thumbPublicUrl } from '@/lib/mediaUrl';

/**
 * Turn a canonical media URL into one the browser can load.
 *
 * Returns '' until the signature arrives for URLs that need one, so a component
 * never briefly renders a canonical URL that would 400 against a private
 * bucket. URLs that are not ours (data:, blob:, Google Drive, Supabase Storage)
 * pass straight through with no round trip and no flash of empty state.
 */
export function useSignedMedia(url: string | null | undefined): string {
  const [signed, setSigned] = useState<string>(() => passThrough(url));

  useEffect(() => {
    const direct = passThrough(url);
    if (direct || !url) {
      setSigned(direct);
      return;
    }

    let active = true;
    setSigned('');
    signMediaUrl(url).then((next) => {
      if (active) setSigned(next);
    });

    return () => { active = false; };
  }, [url]);

  return signed;
}

/**
 * Batch variant for lists. Returns a lookup keyed by the URL you passed in;
 * miss = not signed yet.
 */
export function useSignedMediaMap(urls: (string | null | undefined)[]): Map<string, string> {
  const fingerprint = urls.filter(Boolean).join('|');
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    signMediaUrls(urls).then((next) => {
      if (active) setMap(next);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  return map;
}

/**
 * URLs that are already loadable, resolved synchronously so they never blank
 * out: anything that is not ours, plus thumbnails, which the Worker serves
 * unauthenticated and which therefore need no round trip.
 */
function passThrough(url: string | null | undefined): string {
  if (!url) return '';
  const key = mediaKey(url);
  if (!key) return url;
  return key.startsWith('thumbs/') ? thumbPublicUrl(url) : '';
}
