import { createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptedAuditLog } from '../src/audit/auditLog.js';
import { createAuditEvent, type AuditEvent } from '../src/audit/auditTypes.js';
import type { SecureKeyStore } from '../src/audit/keyStore.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('EncryptedAuditLog', () => {
  it('writes encrypted append-only records without plaintext values', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'warden-audit-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'audit.log.enc');
    const key = Buffer.alloc(32, 7);
    const keyStore: SecureKeyStore = { getOrCreateKey: async () => key };
    const log = new EncryptedAuditLog({ filePath, keyStore });
    const event = createAuditEvent('identifier', 'confidentialAccountName');

    await log.record([event]);

    const raw = await readFile(filePath, 'utf8');
    expect(raw).not.toContain('confidentialAccountName');
    expect(raw).not.toContain(event.valueHash);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const record = JSON.parse(raw) as { iv: string; authTag: string; ciphertext: string };
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    expect(JSON.parse(decrypted) as AuditEvent).toMatchObject(event);
    expect(JSON.parse(decrypted).sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serializes concurrent appends through one queue', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'warden-audit-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'audit.log.enc');
    const keyStore: SecureKeyStore = { getOrCreateKey: async () => Buffer.alloc(32, 3) };
    const log = new EncryptedAuditLog({ filePath, keyStore });

    await Promise.all([
      log.record([createAuditEvent('comment', 'first confidential comment')]),
      log.record([createAuditEvent('string', 'second confidential string')]),
    ]);

    expect((await readFile(filePath, 'utf8')).trim().split('\n')).toHaveLength(2);
  });
});
