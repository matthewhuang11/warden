import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '../audit/auditTypes.js';

export const SYNC_CATEGORIES = ['identifier', 'comment', 'string', 'secret'] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];

export interface SyncPayload {
  version: 1;
  repoLabel: string;
  sessionLabel: string;
  capturedAt: string;
  period: { start: string; end: string };
  totals: Record<SyncCategory, number>;
  hashes: Array<{ category: SyncCategory; valueHash: string; timestamp: string }>;
}

export interface SyncConfig {
  endpoint: string;
  token: string;
}

export function buildSyncPayload(events: Array<AuditEvent & { sessionId?: string }>, repoPath: string): SyncPayload {
  const totals: Record<SyncCategory, number> = { identifier: 0, comment: 0, string: 0, secret: 0 };
  const timestamps = events.map((event) => event.timestamp).sort();
  for (const event of events) totals[event.category] += 1;
  const sessionId = events[0]?.sessionId ?? randomUUID();
  return {
    version: 1,
    repoLabel: pseudonymousLabel('repo', repoPath),
    sessionLabel: pseudonymousLabel('session', sessionId),
    capturedAt: new Date().toISOString(),
    period: { start: timestamps[0] ?? new Date().toISOString(), end: timestamps.at(-1) ?? new Date().toISOString() },
    totals,
    hashes: events.map(({ category, valueHash, timestamp }) => ({ category, valueHash, timestamp })),
  };
}

export function pseudonymousLabel(prefix: 'repo' | 'session', value: string): string {
  return `${prefix}_${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)}`;
}
