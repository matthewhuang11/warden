export type EntityType = 'PERSON' | 'ORGANIZATION' | 'MONEY' | 'EMAIL' | 'PHONE' | 'SSN';

export interface EntityMatch {
  type: EntityType;
  value: string;
  startIndex: number;
  endIndex: number;
}

export interface AnonymizeResult {
  sanitizedText: string;
  mappings: Record<string, string>;
  redactionCount: number;
}

export interface MappingRecord {
  synthetic: string;
  real: string;
  type: EntityType;
  createdAt: number;
}

export interface WardenSettings {
  enabled: boolean;
  sites: {
    chatgpt: boolean;
    claude: boolean;
  };
}

export interface WardenSessionState {
  redactionCount: number;
  mappings: MappingRecord[];
}

export type WardenMessage =
  | { type: 'WARDEN_GET_STATE' }
  | { type: 'WARDEN_STATE_RESPONSE'; payload: WardenSessionState & { supported: boolean; enabled: boolean; siteEnabled: boolean } }
  | { type: 'WARDEN_CLEAR_SESSION' }
  | { type: 'WARDEN_REDACTION_MADE'; payload: { count: number } };

export type SiteKey = 'chatgpt' | 'claude';

export interface SiteAdapter {
  key: SiteKey;
  name: string;
  matchesHost(hostname: string): boolean;
  getInputElement(): HTMLElement | null;
  getSendButton(): HTMLElement | null;
  /**
   * Optional, site-specific readiness check used as an extra gate before we
   * touch the DOM at all -- lets an adapter report "React has hydrated
   * enough to be safe" beyond just "the input element exists". Adapters
   * that don't implement it are treated as always-ready.
   */
  isHydrated?(): boolean;
}
