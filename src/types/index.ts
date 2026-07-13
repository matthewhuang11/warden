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
