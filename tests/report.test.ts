import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptedAuditLog } from '../src/audit/auditLog.js';
import { createAuditEvent } from '../src/audit/auditTypes.js';
import type { SecureKeyStore } from '../src/audit/keyStore.js';
import { formatStats, renderReport, summarizeEvents, writeReport } from '../src/report/report.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('local protection report', () => {
  it('shares category totals with the terminal stats view', () => {
    const summary = summarizeEvents([
      { ...createAuditEvent('identifier', 'a'), sessionId: 'session-a' },
      { ...createAuditEvent('comment', 'b'), sessionId: 'session-a' },
    ]);

    expect(summary).toMatchObject({ identifiers: 1, comments: 1, strings: 0, secrets: 0, sessions: 1 });
    expect(formatStats(summary)).toContain('1 identifiers, 1 comments, and 0 strings transformed across 1 sessions.');
  });

  it('renders category totals, timeline, and plain-language summary', () => {
    const html = renderReport([
      { ...createAuditEvent('identifier', 'a'), sessionId: 'session-a' },
      { ...createAuditEvent('identifier', 'b'), sessionId: 'session-a' },
      { ...createAuditEvent('comment', 'c'), sessionId: 'session-b' },
      { ...createAuditEvent('string', 'd'), sessionId: 'session-b' },
    ]);

    expect(html).toContain('2 identifiers, 1 comment, and 1 string were transformed');
    expect(html).toContain('across 2 sessions');
    expect(html).toContain('Timeline');
    expect(html).toContain('Identifiers');
    expect(html).not.toContain('confidential');
  });

  it('reads encrypted events and writes a private static report without opening a browser in tests', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'warden-report-'));
    directories.push(directory);
    const keyStore: SecureKeyStore = { getOrCreateKey: async () => Buffer.alloc(32, 5) };
    const log = new EncryptedAuditLog({ filePath: path.join(directory, 'audit.log.enc'), keyStore });
    await log.record([createAuditEvent('identifier', 'hidden-name')]);
    const outputPath = path.join(directory, 'report.html');

    await writeReport(renderReport(await log.read()), { outputPath, openBrowser: false });

    expect(await stat(outputPath)).toBeTruthy();
    expect(await readFile(outputPath, 'utf8')).toContain('1 identifier');
  });
});
