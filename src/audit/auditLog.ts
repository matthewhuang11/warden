import { randomBytes, createCipheriv } from 'node:crypto';
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AuditEvent } from './auditTypes.js';
import { MacKeychainStore, type SecureKeyStore } from './keyStore.js';

interface EncryptedAuditRecord {
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface AuditLogOptions {
  filePath: string;
  keyStore?: SecureKeyStore;
}

/** Append-only encrypted local audit log. Plaintext events exist only in memory. */
export class EncryptedAuditLog {
  private readonly keyStore: SecureKeyStore;
  private writeQueue: Promise<void> = Promise.resolve();
  private keyPromise: Promise<Buffer> | undefined;

  constructor(private readonly options: AuditLogOptions) {
    this.keyStore = options.keyStore ?? new MacKeychainStore();
  }

  record(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    this.writeQueue = this.writeQueue.then(() => this.append(events));
    return this.writeQueue;
  }

  private async append(events: AuditEvent[]): Promise<void> {
    const key = await this.getKey();
    await mkdir(path.dirname(this.options.filePath), { recursive: true, mode: 0o700 });
    const records = events.map((event) => this.encrypt(event, key));
    await appendFile(this.options.filePath, records.map((record) => `${JSON.stringify(record)}\n`).join(''), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await chmod(this.options.filePath, 0o600);
  }

  private getKey(): Promise<Buffer> {
    this.keyPromise ??= this.keyStore.getOrCreateKey();
    return this.keyPromise;
  }

  private encrypt(event: AuditEvent, key: Buffer): EncryptedAuditRecord {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(event), 'utf8'), cipher.final()]);
    return {
      version: 1,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }
}
