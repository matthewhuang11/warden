import type { DeclKind } from './scopeAnalyzer.js';

// Widens the identifier-renaming vocabulary (DeclKind) with a 'string' kind
// for redacted string-literal content (see redactSensitiveText.ts). A
// DeclKind value is always assignable where RenameKind is expected, so this
// is purely additive — existing calls passing a DeclKind are untouched.
export type RenameKind = DeclKind | 'string';
export type RenameStyle = 'compact' | 'stealth';

const KIND_PREFIX: Record<RenameKind, string> = {
  function: 'func',
  variable: 'var',
  class: 'class',
  string: 'str',
};

const STEALTH_NAMES: Record<RenameKind, string[]> = {
  function: ['resolveRecord', 'buildSummary', 'prepareResult', 'loadContext', 'deriveValue', 'calculateTotal'],
  variable: ['currentValue', 'cachedValue', 'pendingState', 'computedResult', 'recordState', 'localContext'],
  class: ['RecordModel', 'DataProcessor', 'RequestContext', 'ValueResolver', 'ResultBuilder', 'StateManager'],
  string: ['descriptiveText', 'contextLabel', 'internalMessage', 'displayNote', 'summaryText', 'detailMessage'],
};

/**
 * Session-lifetime, in-memory-only mapping between original identifier
 * names and synthetic placeholders. Keyed by original name (not by
 * declaration site), so the same source name always obfuscates to the
 * same placeholder across requests in a session — this is safe even when
 * two unrelated locals share a name, because rehydration is a plain
 * string reversal and both would round-trip back to their own real name
 * regardless of whether the map conflated them in between.
 */
export class RenameMap {
  private readonly toSynthetic = new Map<string, string>();
  private readonly toOriginal = new Map<string, string>();
  private readonly lastUsedAt = new Map<string, number>();
  private readonly countersByKind = new Map<RenameKind, number>();
  private forbiddenNames = new Set<string>();

  constructor(
    private readonly maxEntries = 10_000,
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly style: RenameStyle = 'compact',
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries <= 0 ||
      !Number.isInteger(ttlMs) ||
      ttlMs <= 0 ||
      !['compact', 'stealth'].includes(style)
    ) {
      throw new Error(`Invalid RenameMap maxEntries: ${maxEntries}`);
    }
  }

  setForbiddenNames(names: Iterable<string>): void {
    this.forbiddenNames = new Set(names);
  }

  clearForbiddenNames(): void {
    this.forbiddenNames.clear();
  }

  get isStealth(): boolean {
    return this.style === 'stealth';
  }

  /** Looks up an existing mapping without creating one. */
  get(originalName: string): string | undefined {
    const synthetic = this.toSynthetic.get(originalName);
    if (synthetic === undefined) return undefined;
    if (this.isExpired(originalName)) {
      this.remove(originalName);
      return undefined;
    }
    this.lastUsedAt.set(originalName, Date.now());
    return synthetic;
  }

  getOrCreate(originalName: string, kind: RenameKind): string {
    const existing = this.get(originalName);
    if (existing) return existing;

    const next = (this.countersByKind.get(kind) ?? 0) + 1;
    this.countersByKind.set(kind, next);
    const synthetic = this.allocateName(originalName, kind, next);

    this.purgeExpired();
    if (this.toSynthetic.size >= this.maxEntries) {
      const oldest = this.toSynthetic.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        this.remove(oldest);
      }
    }

    this.toSynthetic.set(originalName, synthetic);
    this.toOriginal.set(synthetic, originalName);
    this.lastUsedAt.set(originalName, Date.now());
    return synthetic;
  }

  reverseLookup(syntheticName: string): string | undefined {
    const originalName = this.toOriginal.get(syntheticName);
    if (originalName === undefined) return undefined;
    if (this.isExpired(originalName)) {
      this.remove(originalName);
      return undefined;
    }
    this.lastUsedAt.set(originalName, Date.now());
    return originalName;
  }

  get size(): number {
    this.purgeExpired();
    return this.toSynthetic.size;
  }

  syntheticNames(): string[] {
    this.purgeExpired();
    return [...this.toOriginal.keys()];
  }

  /** Every original name the session has already committed to a synthetic for. */
  originalNames(): string[] {
    this.purgeExpired();
    return [...this.toSynthetic.keys()];
  }

  private isExpired(originalName: string): boolean {
    return Date.now() - (this.lastUsedAt.get(originalName) ?? 0) >= this.ttlMs;
  }

  private purgeExpired(): void {
    for (const originalName of this.toSynthetic.keys()) {
      if (this.isExpired(originalName)) this.remove(originalName);
    }
  }

  private remove(originalName: string): void {
    const synthetic = this.toSynthetic.get(originalName);
    this.toSynthetic.delete(originalName);
    this.lastUsedAt.delete(originalName);
    if (synthetic !== undefined) this.toOriginal.delete(synthetic);
  }

  private allocateName(originalName: string, kind: RenameKind, counter: number): string {
    if (this.style === 'compact') return `${KIND_PREFIX[kind]}_${counter.toString(36)}`;

    const names = STEALTH_NAMES[kind];
    for (let offset = 0; offset < names.length; offset++) {
      const candidate = names[(counter - 1 + offset) % names.length];
      if (candidate !== originalName && !this.forbiddenNames.has(candidate) && !this.toOriginal.has(candidate)) {
        return candidate;
      }
    }

    let suffix = counter.toString(36);
    let candidate = `${names[(counter - 1) % names.length]}${suffix}`;
    while (candidate === originalName || this.forbiddenNames.has(candidate) || this.toOriginal.has(candidate)) {
      suffix = `${suffix}x`;
      candidate = `${names[(counter - 1) % names.length]}${suffix}`;
    }
    return candidate;
  }
}
