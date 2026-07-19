import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSyncPayload } from '../src/sync/syncPayload.js';
import { readSyncConfig, writeSyncConfig } from '../src/sync/syncConfig.js';
import { sendSyncPayload } from '../src/sync/syncClient.js';

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.WARDEN_CONNECT_CONFIG;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('opt-in team sync', () => {
  it('builds an aggregate-only payload with pseudonymous labels', () => {
    const payload = buildSyncPayload(
      [{ category: 'identifier', valueHash: 'a'.repeat(64), timestamp: '2026-07-19T14:00:00.000Z', sessionId: 'secret-session' }],
      '/Users/example/private-repo',
    );
    expect(payload.repoLabel).toMatch(/^repo_[a-f0-9]{16}$/);
    expect(payload.sessionLabel).toMatch(/^session_[a-f0-9]{16}$/);
    expect(JSON.stringify(payload)).not.toContain('private-repo');
    expect(JSON.stringify(payload)).not.toContain('secret-session');
  });

  it('makes no network request when connect configuration is absent', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'warden-sync-'));
    directories.push(directory);
    process.env.WARDEN_CONNECT_CONFIG = path.join(directory, 'missing.json');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await readSyncConfig()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the validated aggregate payload after connect', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'warden-sync-'));
    directories.push(directory);
    process.env.WARDEN_CONNECT_CONFIG = path.join(directory, 'connect.json');
    await writeSyncConfig({ endpoint: 'https://dashboard.example.test/api/sync', token: 'org-token' });
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const events = [{ category: 'comment' as const, valueHash: 'b'.repeat(64), timestamp: '2026-07-19T14:00:00.000Z', sessionId: 'session-value' }];
    await sendSyncPayload((await readSyncConfig())!, events, '/Users/example/private-repo');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({ authorization: 'Bearer org-token', 'content-type': 'application/json' });
    expect(request.body).not.toContain('private-repo');
    expect(request.body).not.toContain('session-value');
  });
});
