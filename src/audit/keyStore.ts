import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE = 'com.warden.proxy.audit-key';
const ACCOUNT = 'local-audit-log';

export interface SecureKeyStore {
  getOrCreateKey(): Promise<Buffer>;
}

/** macOS Keychain-backed key storage. The key never lives beside the log. */
export class MacKeychainStore implements SecureKeyStore {
  async getOrCreateKey(): Promise<Buffer> {
    if (process.platform !== 'darwin') {
      throw new Error('Encrypted audit logging currently requires macOS Keychain');
    }

    try {
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
      const key = Buffer.from(stdout.trim(), 'base64');
      if (key.length !== 32) throw new Error('Keychain audit key has an invalid length');
      return key;
    } catch (error) {
      const key = randomBytes(32);
      await execFileAsync('security', [
        'add-generic-password',
        '-U',
        '-s',
        SERVICE,
        '-a',
        ACCOUNT,
        '-w',
        key.toString('base64'),
      ]);
      return key;
    }
  }
}
