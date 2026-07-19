import { createHash } from 'node:crypto';

export const SYNC_CATEGORIES = ['identifier', 'comment', 'string', 'secret'] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];

export interface SyncHash {
  category: SyncCategory;
  valueHash: string;
  timestamp: string;
}

export interface SyncPayload {
  version: 1;
  repoLabel: string;
  sessionLabel: string;
  capturedAt: string;
  period: { start: string; end: string };
  totals: Record<SyncCategory, number>;
  hashes: SyncHash[];
}

const ALLOWED_ROOT_KEYS = new Set(['version', 'repoLabel', 'sessionLabel', 'capturedAt', 'period', 'totals', 'hashes']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REPO_LABEL_PATTERN = /^repo_[a-f0-9]{16}$/;
const SESSION_LABEL_PATTERN = /^session_[a-f0-9]{16}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_COUNT = 100_000_000;
const MAX_HASHES = 100_000;

export function parseSyncPayload(input: unknown): SyncPayload {
  if (!isRecord(input) || !hasOnlyKeys(input, ALLOWED_ROOT_KEYS)) throw new Error('Invalid sync payload shape');
  if (input.version !== 1 || !isPseudonymousLabel(input.repoLabel, REPO_LABEL_PATTERN) || !isPseudonymousLabel(input.sessionLabel, SESSION_LABEL_PATTERN)) {
    throw new Error('Invalid sync payload identity');
  }
  if (!isTimestamp(input.capturedAt) || !isRecord(input.period) || !hasOnlyKeys(input.period, new Set(['start', 'end']))) {
    throw new Error('Invalid sync payload timestamps');
  }
  if (!isTimestamp(input.period.start) || !isTimestamp(input.period.end)) throw new Error('Invalid sync payload period');

  const totals = parseTotals(input.totals);
  if (!Array.isArray(input.hashes) || input.hashes.length > MAX_HASHES) throw new Error('Invalid sync payload hashes');
  const hashes = input.hashes.map(parseHash);
  return {
    version: 1,
    repoLabel: input.repoLabel,
    sessionLabel: input.sessionLabel,
    capturedAt: input.capturedAt,
    period: { start: input.period.start, end: input.period.end },
    totals,
    hashes,
  };
}

export function makePseudonymousLabel(prefix: 'repo' | 'session', stableLocalValue: string): string {
  return `${prefix}_${createHash('sha256').update(stableLocalValue, 'utf8').digest('hex').slice(0, 16)}`;
}

function parseTotals(input: unknown): Record<SyncCategory, number> {
  if (!isRecord(input) || !hasOnlyKeys(input, new Set(SYNC_CATEGORIES))) throw new Error('Invalid sync totals');
  const totals = {} as Record<SyncCategory, number>;
  for (const category of SYNC_CATEGORIES) {
    const value = input[category];
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) throw new Error('Invalid sync total');
    totals[category] = value;
  }
  return totals;
}

function parseHash(input: unknown): SyncHash {
  if (!isRecord(input) || !hasOnlyKeys(input, new Set(['category', 'valueHash', 'timestamp']))) throw new Error('Invalid sync hash');
  if (!SYNC_CATEGORIES.includes(input.category as SyncCategory) || typeof input.valueHash !== 'string' || !HASH_PATTERN.test(input.valueHash) || !isTimestamp(input.timestamp)) {
    throw new Error('Invalid sync hash contents');
  }
  return { category: input.category as SyncCategory, valueHash: input.valueHash, timestamp: input.timestamp };
}

function isPseudonymousLabel(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
