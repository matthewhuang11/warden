import type { DeclKind } from './scopeAnalyzer.js';

const KIND_PREFIX: Record<DeclKind, string> = {
  function: 'func',
  variable: 'var',
  class: 'class',
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
  private readonly countersByKind = new Map<DeclKind, number>();

  /** Looks up an existing mapping without creating one. */
  get(originalName: string): string | undefined {
    return this.toSynthetic.get(originalName);
  }

  getOrCreate(originalName: string, kind: DeclKind): string {
    const existing = this.toSynthetic.get(originalName);
    if (existing) return existing;

    const prefix = KIND_PREFIX[kind];
    const next = (this.countersByKind.get(kind) ?? 0) + 1;
    this.countersByKind.set(kind, next);
    const synthetic = `${prefix}_${next.toString(36)}`;

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
