import type { AuditEvent } from './auditTypes.js';
import type { EncryptedAuditLog } from './auditLog.js';
import { logger } from '../log.js';

interface AuditSink {
  record(events: AuditEvent[]): Promise<void>;
}

const noopAuditSink: AuditSink = { record: async () => undefined };
let activeAuditSink: AuditSink = noopAuditSink;

export function configureAuditLog(auditLog: EncryptedAuditLog): void {
  activeAuditSink = auditLog;
}

export async function recordAuditEvents(events: AuditEvent[]): Promise<void> {
  try {
    await activeAuditSink.record(events);
  } catch (error) {
    logger.error('audit.write_failed', { errorType: error instanceof Error ? error.name : typeof error });
  }
}
