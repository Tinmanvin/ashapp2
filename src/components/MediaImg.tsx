import type { ImgHTMLAttributes } from 'react';
import { useSignedMedia } from '@/hooks/useSignedMedia';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /** Canonical media URL — signed automatically before it reaches the DOM. */
  src: string | null | undefined;
};

/**
 * Drop-in <img> for media held in the private bucket.
 *
 * Renders nothing until a signed URL is ready, which avoids a request that
 * would 400 and leave a browser-drawn broken-image icon in the grid.
 */
export function MediaImg({ src, ...rest }: Props) {
  const signed = useSignedMedia(src);
  if (!signed) return null;
  return <img src={signed} {...rest} />;
}
