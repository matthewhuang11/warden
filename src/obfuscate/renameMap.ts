import type { DeclKind } from './scopeAnalyzer.js';

// Widens the identifier-renaming vocabulary (DeclKind) with a 'string' kind
// for redacted string-literal content (see redactSensitiveText.ts). A
// DeclKind value is always assignable where RenameKind is expected, so this
// is purely additive — existing calls passing a DeclKind are untouched.
export type RenameKind = DeclKind | 'string';

const KIND_PREFIX: Record<RenameKind, string> = {
  function: 'func',
  variable: 'var',
  class: 'class',
  string: 'str',
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

  constructor(
    private readonly maxEntries = 10_000,
    private readonly ttlMs = 30 * 60 * 1000,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0 || !Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error(`Invalid RenameMap maxEntries: ${maxEntries}`);
    }
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
    const existing = this.toSynthetic.get(originalName);
    if (existing) return existing;

    const prefix = KIND_PREFIX[kind];
    const next = (this.countersByKind.get(kind) ?? 0) + 1;
    this.countersByKind.set(kind, next);
    const synthetic = `${prefix}_${next.toString(36)}`;

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
}
