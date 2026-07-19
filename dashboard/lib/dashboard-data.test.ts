import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardSnapshot } from './dashboard-data';
import { renderSyncedReport } from './export-report';
import type { SyncPayload } from './sync-schema';

const payload: SyncPayload = {
  version: 1,
  repoLabel: 'repo_aaaaaaaaaaaaaaaa',
  sessionLabel: 'session_bbbbbbbbbbbbbbbb',
  capturedAt: '2026-07-19T14:00:00.000Z',
  period: { start: '2026-07-19T13:00:00.000Z', end: '2026-07-19T14:00:00.000Z' },
  totals: { identifier: 2, comment: 1, string: 1, secret: 0 },
  hashes: [],
};

test('aggregates payloads by repository and day', () => {
  const snapshot = buildDashboardSnapshot([payload]);
  assert.equal(snapshot.totals.identifier, 2);
  assert.equal(snapshot.byRepo[0]?.total, 4);
  assert.equal(snapshot.byDay[0]?.day, '2026-07-19');
});

test('export contains aggregate data but no hash or source values', () => {
  const html = renderSyncedReport([{ ...payload, hashes: [{ category: 'identifier', valueHash: 'a'.repeat(64), timestamp: payload.capturedAt }] }]);
  assert.match(html, /4 aggregate transformations/);
  assert.doesNotMatch(html, /a{64}/);
  assert.doesNotMatch(html, /calculateRenewalOffer|function /);
});
