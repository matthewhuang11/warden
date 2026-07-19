import { timingSafeEqual } from 'node:crypto';

export function hasValidBearerToken(header: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
