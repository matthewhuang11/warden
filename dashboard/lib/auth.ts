import { createHash, timingSafeEqual } from 'node:crypto';

export const DASHBOARD_SESSION_COOKIE = 'warden_dashboard_session';
const MAX_SECRET_LENGTH = 4096;

export function hasValidBearerToken(header: string | null, expected: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  return hasValidSecret(header.slice('Bearer '.length), expected);
}

export function hasValidSecret(supplied: unknown, expected: string | undefined): boolean {
  if (typeof supplied !== 'string' || !expected) return false;
  if (supplied.length === 0 || supplied.length > MAX_SECRET_LENGTH || expected.length > MAX_SECRET_LENGTH) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function createDashboardSession(expected: string): string {
  return createHash('sha256').update('warden-dashboard-session\0').update(expected, 'utf8').digest('hex');
}

export function hasValidDashboardSession(cookieValue: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  return hasValidSecret(cookieValue, createDashboardSession(expected));
}
