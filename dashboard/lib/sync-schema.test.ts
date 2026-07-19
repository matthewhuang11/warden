import assert from 'node:assert/strict';
import test from 'node:test';
import { makePseudonymousLabel, parseSyncPayload } from './sync-schema';

const validPayload = () => ({
  version: 1,
  repoLabel: makePseudonymousLabel('repo', '/work/example'),
  sessionLabel: makePseudonymousLabel('session', 'session-1'),
  capturedAt: '2026-07-19T14:00:00.000Z',
  period: { start: '2026-07-19T13:00:00.000Z', end: '2026-07-19T14:00:00.000Z' },
  totals: { identifier: 2, comment: 1, string: 1, secret: 0 },
  hashes: [{ category: 'identifier', valueHash: 'a'.repeat(64), timestamp: '2026-07-19T14:00:00.000Z' }],
});

test('accepts the aggregate-only sync contract', () => {
  assert.deepEqual(parseSyncPayload(validPayload()).totals, { identifier: 2, comment: 1, string: 1, secret: 0 });
});

test('rejects plaintext source fields and source-like labels', () => {
  const payload = validPayload() as Record<string, unknown>;
  payload.source = 'function calculateRenewalOffer() {}';
  assert.throws(() => parseSyncPayload(payload), /shape/);

  const withPath = validPayload();
  withPath.repoLabel = '/Users/matthew/project';
  assert.throws(() => parseSyncPayload(withPath), /identity/);
});

test('rejects non-hash values, extra nested fields, and negative counts', () => {
  const invalidHash = validPayload();
  invalidHash.hashes[0].valueHash = 'calculateRenewalOffer';
  assert.throws(() => parseSyncPayload(invalidHash), /hash/);

  const invalidCount = validPayload();
  invalidCount.totals.identifier = -1;
  assert.throws(() => parseSyncPayload(invalidCount), /total/);

  const extraNested = validPayload();
  (extraNested.period as Record<string, unknown>).source = 'code';
  assert.throws(() => parseSyncPayload(extraNested), /timestamps/);
});
