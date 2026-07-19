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
  type: 'type',
  string: 'str',
};

interface StealthTheme {
  names: Record<RenameKind, readonly string[]>;
}

const STEALTH_THEMES: readonly StealthTheme[] = [
  {
    names: {
      function: ['evaluatePolicy', 'validatePolicyInput', 'resolvePolicyDecision', 'buildPolicyResult', 'selectPolicyRule'],
      variable: [
        'baselineValue',
        'durationThreshold',
        'policyAdjustment',
        'reviewThreshold',
        'maximumLimit',
        'primaryComponent',
        'secondaryComponent',
        'conditionalAdjustment',
        'calculatedLimit',
        'resultingAmount',
        'effectiveWindow',
        'evaluationStatus',
        'inputRecord',
        'policyOptions',
        'selectedRule',
        'weightedFactor',
        'aggregateTotal',
        'decisionState',
        'recordCount',
        'recordIndex',
      ],
      class: ['PolicyStore', 'PolicyReader', 'PolicyWriter', 'PolicyResolver', 'PolicyCoordinator'],
      type: ['PolicyInput', 'PolicyDecision', 'PolicyContext', 'PolicyResult', 'PolicyOptions', 'PolicySnapshot'],
      string: ['policyDescription', 'policyLabel', 'policyMessage', 'policyNote', 'policySummary', 'policyDetails'],
    },
  },
  {
    names: {
      function: ['assessRecord', 'validateRecord', 'determineOutcome', 'createAssessment', 'selectAssessmentRule'],
      variable: [
        'baseAmount',
        'ageThreshold',
        'riskAdjustment',
        'escalationThreshold',
        'upperLimit',
        'initialComponent',
        'supplementalComponent',
        'eligibilityAdjustment',
        'assessedLimit',
        'finalAmount',
        'responseWindow',
        'assessmentStatus',
        'subjectRecord',
        'assessmentOptions',
        'selectedCriterion',
        'scoringFactor',
        'combinedTotal',
        'outcomeState',
        'itemCount',
        'itemIndex',
      ],
      class: ['AssessmentStore', 'AssessmentReader', 'AssessmentWriter', 'AssessmentResolver', 'AssessmentCoordinator'],
      type: ['AssessmentInput', 'AssessmentOutcome', 'AssessmentContext', 'AssessmentResult', 'AssessmentOptions', 'AssessmentSnapshot'],
      string: ['assessmentDescription', 'assessmentLabel', 'assessmentMessage', 'assessmentNote', 'assessmentSummary', 'assessmentDetails'],
    },
  },
  {
    names: {
      function: ['processRequest', 'validateRequest', 'determineRoute', 'createResponse', 'selectWorkflowRule'],
      variable: [
        'defaultValue',
        'timingThreshold',
        'routeAdjustment',
        'reviewBoundary',
        'allowedMaximum',
        'sourceComponent',
        'additionalComponent',
        'conditionalValue',
        'computedValue',
        'outputAmount',
        'processingWindow',
        'workflowStatus',
        'requestRecord',
        'workflowOptions',
        'selectedRoute',
        'priorityFactor',
        'accumulatedTotal',
        'responseState',
        'requestCount',
        'requestIndex',
      ],
      class: ['WorkflowStore', 'WorkflowReader', 'WorkflowWriter', 'WorkflowResolver', 'WorkflowCoordinator'],
      type: ['WorkflowRequest', 'WorkflowResponse', 'WorkflowContext', 'WorkflowResult', 'WorkflowOptions', 'WorkflowSnapshot'],
      string: ['workflowDescription', 'workflowLabel', 'workflowMessage', 'workflowNote', 'workflowSummary', 'workflowDetails'],
    },
  },
];

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
  private readonly stealthTheme: StealthTheme;
  private stealthFallbackUsed = false;

  constructor(
    private readonly maxEntries = 10_000,
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly style: RenameStyle = 'compact',
    stealthThemeIndex?: number,
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries <= 0 ||
      !Number.isInteger(ttlMs) ||
      ttlMs <= 0 ||
      !['compact', 'stealth'].includes(style) ||
      (stealthThemeIndex !== undefined &&
        (!Number.isInteger(stealthThemeIndex) || stealthThemeIndex < 0 || stealthThemeIndex >= STEALTH_THEMES.length))
    ) {
      throw new Error(`Invalid RenameMap maxEntries: ${maxEntries}`);
    }

    const selectedThemeIndex = stealthThemeIndex ?? Math.floor(Math.random() * STEALTH_THEMES.length);
    this.stealthTheme = STEALTH_THEMES[selectedThemeIndex];
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

  get usedStealthFallback(): boolean {
    return this.stealthFallbackUsed;
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

    this.store(originalName, synthetic);
    return synthetic;
  }

  /** Registers a syntax-safe replacement chosen by a structural redaction
   * pass. Returns undefined when that exact token already exists in the
   * source or map, so callers can avoid ambiguous reverse substitution. */
  registerExactReplacement(originalText: string, replacementText: string): string | undefined {
    const existing = this.get(originalText);
    if (existing) return existing === replacementText ? existing : undefined;
    if (
      originalText.length === 0 ||
      replacementText.length === 0 ||
      originalText === replacementText ||
      this.forbiddenNames.has(replacementText) ||
      this.toOriginal.has(replacementText)
    ) {
      return undefined;
    }

    this.store(originalText, replacementText);
    return replacementText;
  }

  private store(originalName: string, synthetic: string): void {
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

    const names = this.stealthTheme.names[kind];
    for (let offset = 0; offset < names.length; offset++) {
      const candidate = names[(counter - 1 + offset) % names.length];
      if (candidate !== originalName && !this.forbiddenNames.has(candidate) && !this.toOriginal.has(candidate)) {
        return candidate;
      }
    }

    this.stealthFallbackUsed = true;
    let suffix = counter.toString(36);
    let candidate = `${names[(counter - 1) % names.length]}${suffix}`;
    while (candidate === originalName || this.forbiddenNames.has(candidate) || this.toOriginal.has(candidate)) {
      suffix = `${suffix}x`;
      candidate = `${names[(counter - 1) % names.length]}${suffix}`;
    }
    return candidate;
  }
}
