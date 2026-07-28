/**
 * keys.ts — storage-key validation.
 *
 * Every key the Worker will act on has to pass through here. The bucket holds
 * exactly three prefixes; anything else is a caller mistake or an attack, and
 * either way it gets a 400 rather than a signed URL.
 */

const ALLOWED_PREFIXES = ['files/', 'thumbs/', 'compressed/'] as const;

/** Conservative on purpose — our own keys are `<prefix>/<timestamp>-<random>.<ext>`. */
const KEY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,255}$/;

export function isValidKey(key: string): boolean {
  if (!key || !KEY_SHAPE.test(key)) return false;
  if (key.includes('..') || key.includes('//')) return false;
  return ALLOWED_PREFIXES.some((p) => key.startsWith(p));
}

export function isThumbKey(key: string): boolean {
  return isValidKey(key) && key.startsWith('thumbs/');
}
