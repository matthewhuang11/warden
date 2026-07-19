import type { AuditEvent } from './auditTypes.js';
import type { EncryptedAuditLog } from './auditLog.js';
import { logger } from '../log.js';
import { readSyncConfig } from '../sync/syncConfig.js';
import { sendSyncPayload } from '../sync/syncClient.js';

interface AuditSink {
  record(events: AuditEvent[]): Promise<void>;
}

const noopAuditSink: AuditSink = { record: async () => undefined };
let activeAuditSink: AuditSink = noopAuditSink;

export function configureAuditLog(auditLog: EncryptedAuditLog): void {
  activeAuditSink = auditLog;
}

export async function recordAuditEvents(events: AuditEvent[]): Promise<void> {
  if (events.length === 0) return;
  let persisted = false;
  try {
    await activeAuditSink.record(events);
    persisted = true;
  } catch (error) {
    logger.error('audit.write_failed', { errorType: error instanceof Error ? error.name : typeof error });
  }
  if (!persisted) return;
  const config = await readSyncConfig();
  if (!config) return;
  try {
    await sendSyncPayload(config, events, process.cwd());
  } catch (error) {
    logger.warn('dashboard.sync_failed', { errorType: error instanceof Error ? error.name : typeof error });
  }
}
