import type { AuditEvent } from '../audit/auditTypes.js';
import { buildSyncPayload, type SyncConfig } from './syncPayload.js';

export async function sendSyncPayload(config: SyncConfig, events: Array<AuditEvent & { sessionId?: string }>, repoPath: string): Promise<void> {
  if (events.length === 0) return;
  const payload = buildSyncPayload(events, repoPath);
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Dashboard sync failed with status ${response.status}`);
}
