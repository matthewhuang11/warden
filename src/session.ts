import { RenameMap } from './obfuscate/renameMap.js';
import { dirname } from 'node:path';
import {
  transformCoherentCoverStory,
  type CoverStoryPlan,
  type CoherentCoverStoryResult,
} from './obfuscate/coherentCoverStory.js';
import { rehydrateCoverStoryText } from './rehydrate/rehydrateCoverStory.js';
import { config } from './config.js';

// Real names never leave the machine; synthetic names never touch disk.
// This map lives only as long as the proxy process runs and is never
// persisted, matching the "session-only" requirement. It's a singleton
// (not per-request) because Claude Code resends full conversation history
// on every turn — the same original name must always obfuscate to the
// same synthetic name across turns for the model's context to stay
// coherent, and for our own SSE rehydration to reverse it correctly.
export const sessionRenameMap = new RenameMap(config.maxSessionMappings, config.sessionMappingTtlMs, 'stealth');

interface StoredCoverStoryPlan {
  label: string;
  plan: CoverStoryPlan;
  lastUsedAt: number;
}

interface StoredPathAlias {
  original: string;
  alias: string;
  lastUsedAt: number;
}

/**
 * Session-lifetime registry for the additive coherent mode. Plans are kept
 * per file label so prior conversation turns remain rehydratable. The
 * reverse maps are also merged across files: existing names are reused and
 * new synthetic names are reserved, preventing cross-file collisions.
 */
export class CoherentCoverStorySession {
  private readonly plans: StoredCoverStoryPlan[] = [];
  private readonly identifiers = new Map<string, string>();
  private readonly strings = new Map<string, string>();
  private readonly pathAliases: StoredPathAlias[] = [];

  constructor(
    private readonly maxPlans = 10_000,
    private readonly ttlMs = 30 * 60 * 1000,
  ) {
    if (!Number.isSafeInteger(maxPlans) || maxPlans <= 0 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('Invalid coherent cover story session limits');
    }
  }

  async transform(label: string, source: string): Promise<CoherentCoverStoryResult> {
    this.purgeExpired();
    const result = await transformCoherentCoverStory(source, {
      reservedIdentifierNames: this.identifiers.values(),
      reservedStringValues: this.strings.values(),
      existingIdentifiers: this.identifiers,
      existingStrings: this.strings,
    });
    if (!result.validation.valid) {
      throw new Error(`Cover story validation failed for ${label}: ${result.validation.reason ?? 'unknown reason'}`);
    }

    this.plans.push({ label, plan: result.plan, lastUsedAt: Date.now() });
    this.trimToLimit();
    this.rebuildReverseMaps();
    return result;
  }

  /**
   * Gives the model a neutral path while keeping the exact local path in
   * memory for the response-side tool call. Aliases are session-scoped so a
   * repeated Read/Edit/Write call keeps the same path in the model context.
   */
  aliasPath(original: string): string {
    const extension = original.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '';
    return this.addPathAlias(original, `source${extension}`);
  }

  aliasDirectory(original: string): string {
    if (original === '.' || original === '/' || original.length === 0) return original;
    return this.addPathAlias(original, 'workspace');
  }

  private addPathAlias(original: string, firstAlias: string): string {
    this.purgeExpired();
    const existing = this.pathAliases.find((entry) => entry.original === original);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.alias;
    }

    let counter = 1;
    let alias = firstAlias;
    const aliases = new Set(this.pathAliases.map((entry) => entry.alias));
    while (aliases.has(alias)) {
      counter += 1;
      const extension = firstAlias.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '';
      const stem = extension ? firstAlias.slice(0, -extension.length) : firstAlias;
      alias = `${stem}_${counter}${extension}`;
    }

    this.pathAliases.push({ original, alias, lastUsedAt: Date.now() });
    this.trimPathAliases();
    return alias;
  }

  rehydratePath(alias: string): string {
    this.purgeExpired();
    const entry = this.pathAliases.find((candidate) => candidate.alias === alias);
    if (!entry) return alias;
    entry.lastUsedAt = Date.now();
    return entry.original;
  }

  rehydratePathsInText(text: string): string {
    this.purgeExpired();
    const now = Date.now();
    const aliases = [...this.pathAliases]
      .sort((left, right) => right.alias.length - left.alias.length)
      .map((entry) => {
        entry.lastUsedAt = now;
        return [entry.alias, entry.original] as const;
      });
    let output = text;
    for (const [alias, original] of aliases) {
      output = output.replace(new RegExp(escapeRegExp(alias), 'g'), () => original);
    }
    return output;
  }

  aliasPathsInText(text: string): string {
    this.purgeExpired();
    const now = Date.now();
    const paths = [...this.pathAliases]
      .sort((left, right) => right.original.length - left.original.length)
      .map((entry) => {
        entry.lastUsedAt = now;
        return [entry.original, entry.alias] as const;
      });
    let output = text;
    for (const [original, alias] of paths) {
      output = output.replace(new RegExp(escapeRegExp(original), 'g'), () => alias);
    }
    return output;
  }

  /**
   * Discovers only path-shaped tokens that appear in tool output or prose.
   * This is intentionally conservative: arbitrary words are not treated as
   * paths, and URLs/package names are left alone.
   */
  discoverAndAliasPathsInText(text: string): string {
    this.purgeExpired();
    const candidates = new Set<string>();
    const collect = (pattern: RegExp) => {
      for (const match of text.matchAll(pattern)) {
        const candidate = match[1];
        if (!candidate || candidate.startsWith('//') || candidate.includes('://')) continue;
        candidates.add(candidate);
      }
    };

    collect(PATH_FILE_PATTERN);
    collect(PATH_DIRECTORY_PATTERN);
    for (const candidate of candidates) {
      if (candidate.endsWith('/')) {
        this.aliasDirectory(candidate.slice(0, -1));
      } else {
        this.aliasDirectory(dirname(candidate));
        this.aliasPath(candidate);
      }
    }
    return this.aliasPathsInText(text);
  }

  rehydrateText(text: string): string {
    this.purgeExpired();
    const now = Date.now();
    let output = text;
    for (const stored of this.plans) {
      stored.lastUsedAt = now;
      output = rehydrateCoverStoryText(output, stored.plan);
    }
    return this.rehydratePathsInText(output);
  }

  syntheticNames(): string[] {
    this.purgeExpired();
    const names = new Set<string>();
    for (const { plan } of this.plans) for (const name of plan.syntheticNames) names.add(name);
    for (const entry of this.pathAliases) names.add(entry.alias);
    return [...names];
  }

  get size(): number {
    this.purgeExpired();
    return this.plans.length;
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    const retained = this.plans.filter((stored) => stored.lastUsedAt > cutoff);
    if (retained.length !== this.plans.length) {
      this.plans.splice(0, this.plans.length, ...retained);
      this.rebuildReverseMaps();
    }
    const retainedPaths = this.pathAliases.filter((entry) => entry.lastUsedAt > cutoff);
    if (retainedPaths.length !== this.pathAliases.length) {
      this.pathAliases.splice(0, this.pathAliases.length, ...retainedPaths);
    }
  }

  private trimToLimit(): void {
    if (this.plans.length <= this.maxPlans) return;
    this.plans.splice(0, this.plans.length - this.maxPlans);
  }

  private trimPathAliases(): void {
    if (this.pathAliases.length <= this.maxPlans) return;
    this.pathAliases.splice(0, this.pathAliases.length - this.maxPlans);
  }

  private rebuildReverseMaps(): void {
    this.identifiers.clear();
    this.strings.clear();
    for (const { plan } of this.plans) {
      for (const mapping of plan.identifierMappings) this.identifiers.set(mapping.original, mapping.synthetic);
      for (const mapping of plan.stringMappings) {
        this.strings.set(mapping.original.slice(1, -1), mapping.synthetic.slice(1, -1));
      }
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATH_FILE_PATTERN = /(?<![A-Za-z0-9_$])((?:\/|\.\.?\/|[A-Za-z0-9_-]+\/)(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?![A-Za-z0-9_$])/g;
const PATH_DIRECTORY_PATTERN = /(?<![A-Za-z0-9_$])((?:\/|\.\.?\/|[A-Za-z0-9_-]+\/)(?:[A-Za-z0-9_.-]+\/)+)(?![A-Za-z0-9_$])/g;

export const coherentCoverStorySession = new CoherentCoverStorySession(
  config.maxSessionMappings,
  config.sessionMappingTtlMs,
);
