import { RenameMap } from './obfuscate/renameMap.js';
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

  async transform(label: string, source: string): Promise<CoherentCoverStoryResult> {
    const result = await transformCoherentCoverStory(source, {
      reservedIdentifierNames: this.identifiers.values(),
      reservedStringValues: this.strings.values(),
      existingIdentifiers: this.identifiers,
      existingStrings: this.strings,
    });
    if (!result.validation.valid) {
      throw new Error(`Cover story validation failed for ${label}: ${result.validation.reason ?? 'unknown reason'}`);
    }

    this.plans.push({ label, plan: result.plan });
    for (const mapping of result.plan.identifierMappings) this.identifiers.set(mapping.original, mapping.synthetic);
    for (const mapping of result.plan.stringMappings) {
      const original = mapping.original.slice(1, -1);
      const synthetic = mapping.synthetic.slice(1, -1);
      this.strings.set(original, synthetic);
    }
    return result;
  }

  rehydrateText(text: string): string {
    let output = text;
    for (const { plan } of this.plans) output = rehydrateCoverStoryText(output, plan);
    return output;
  }

  syntheticNames(): string[] {
    const names = new Set<string>();
    for (const { plan } of this.plans) for (const name of plan.syntheticNames) names.add(name);
    return [...names];
  }

  get size(): number {
    return this.plans.length;
  }
}

export const coherentCoverStorySession = new CoherentCoverStorySession();
