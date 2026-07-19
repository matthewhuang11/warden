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
  private readonly countersByKind = new Map<RenameKind, number>();

  constructor(private readonly maxEntries = 10_000) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error(`Invalid RenameMap maxEntries: ${maxEntries}`);
    }
  }

  /** Looks up an existing mapping without creating one. */
  get(originalName: string): string | undefined {
    return this.toSynthetic.get(originalName);
  }

  getOrCreate(originalName: string, kind: RenameKind): string {
    const existing = this.toSynthetic.get(originalName);
    if (existing) return existing;

    const prefix = KIND_PREFIX[kind];
    const next = (this.countersByKind.get(kind) ?? 0) + 1;
    this.countersByKind.set(kind, next);
    const synthetic = `${prefix}_${next.toString(36)}`;

    if (this.toSynthetic.size >= this.maxEntries) {
      const oldest = this.toSynthetic.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        const oldestSynthetic = this.toSynthetic.get(oldest);
        this.toSynthetic.delete(oldest);
        if (oldestSynthetic !== undefined) this.toOriginal.delete(oldestSynthetic);
      }
    }

    this.toSynthetic.set(originalName, synthetic);
    this.toOriginal.set(synthetic, originalName);
    return synthetic;
  }

  reverseLookup(syntheticName: string): string | undefined {
    return this.toOriginal.get(syntheticName);
  }

  get size(): number {
    return this.toSynthetic.size;
  }

  syntheticNames(): string[] {
    return [...this.toOriginal.keys()];
  }

  /** Every original name the session has already committed to a synthetic for. */
  originalNames(): string[] {
    return [...this.toSynthetic.keys()];
  }
}
