import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SyncConfig } from './syncPayload.js';

export function connectConfigPath(): string {
  return process.env.WARDEN_CONNECT_CONFIG ?? path.join(os.homedir(), '.warden', 'connect.json');
}

export async function writeSyncConfig(config: SyncConfig): Promise<void> {
  const filePath = connectConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

export async function readSyncConfig(): Promise<SyncConfig | null> {
  try {
    const parsed = JSON.parse(await readFile(connectConfigPath(), 'utf8')) as Partial<SyncConfig>;
    if (typeof parsed.endpoint !== 'string' || typeof parsed.token !== 'string' || parsed.token.length === 0) return null;
    return { endpoint: parsed.endpoint, token: parsed.token };
  } catch {
    return null;
  }
}
