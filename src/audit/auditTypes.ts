import { createHash } from 'node:crypto';

export type AuditCategory = 'identifier' | 'comment' | 'string' | 'secret';

export interface AuditEvent {
  category: AuditCategory;
  valueHash: string;
  timestamp: string;
}

export function createAuditEvent(category: AuditCategory, value: string): AuditEvent {
  return {
    category,
    valueHash: createHash('sha256').update(value, 'utf8').digest('hex'),
    timestamp: new Date().toISOString(),
  };
}
