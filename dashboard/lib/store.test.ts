import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeStore, insertSyncPayload, listSyncPayloads } from './store';
import type { SyncPayload } from './sync-schema';

test('persists aggregate payloads in the local SQLite fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'warden-dashboard-store-'));
  const previousPath = process.env.WARDEN_DASHBOARD_DB_PATH;
  const previousUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.WARDEN_DASHBOARD_DB_PATH = path.join(directory, 'nested', 'dashboard.db');

  const payload: SyncPayload = {
    version: 1,
    repoLabel: 'repo_aaaaaaaaaaaaaaaa',
    sessionLabel: 'session_bbbbbbbbbbbbbbbb',
    capturedAt: '2026-07-19T14:00:00.000Z',
    period: { start: '2026-07-19T13:00:00.000Z', end: '2026-07-19T14:00:00.000Z' },
    totals: { identifier: 4, comment: 1, string: 2, secret: 0 },
    hashes: [],
  };

  try {
    await insertSyncPayload(payload);
    assert.deepEqual(await listSyncPayloads(), [payload]);
  } finally {
    await closeStore();
    if (previousPath === undefined) delete process.env.WARDEN_DASHBOARD_DB_PATH;
    else process.env.WARDEN_DASHBOARD_DB_PATH = previousPath;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});
