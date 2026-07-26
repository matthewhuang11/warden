import type { CoverStoryPlan } from '../obfuscate/coherentCoverStory.js';

export interface RehydrateCoverStoryOptions {
  includeAddedCommentTerms?: boolean;
}

export interface UnrehydratedCoverStoryTerm {
  term: string;
  comment: string;
}

export interface CoverStoryCommentAdapterContext {
  plan: CoverStoryPlan;
  unresolvedTerms: readonly string[];
}

export interface CoverStoryCommentAdapter {
  rewriteComment(comment: string, context: CoverStoryCommentAdapterContext): Promise<string | null>;
}

/**
 * Rehydrates a coherent-cover-story response without changing the existing
 * RenameMap path. Known generated comments are restored exactly. Comments
 * added by the model are handled best-effort: fake domain nouns that were
 * tied to a source identifier are replaced locally, while genuinely new
 * prose cannot be semantically inverted without an LLM.
 */
export function rehydrateCoverStoryText(
  text: string,
  plan: CoverStoryPlan,
  options: RehydrateCoverStoryOptions = {},
): string {
  let output = replaceExact(outputComments(text, plan), plan.reverseComments);
  output = replaceQuotedStrings(output, plan.reverseStrings);
  output = replaceIdentifiers(output, plan.reverseIdentifiers);
  output = collapseExpandedShorthand(output, plan.reverseIdentifiers);
  return options.includeAddedCommentTerms === false ? output : rehydrateAddedCommentTermsForPlans(output, [plan]);
}

export function rehydrateAddedCommentTerms(text: string, plan: CoverStoryPlan): string {
  return rehydrateAddedCommentTermsForPlans(text, [plan]);
}

export function rehydrateAddedCommentTermsForPlans(text: string, plans: readonly CoverStoryPlan[]): string {
  const knownOriginalComments = new Set(plans.flatMap((plan) => [...plan.reverseComments.values()]));
  return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment) => {
    if (knownOriginalComments.has(comment)) return comment;
    const plan = selectCommentPlan(comment, plans);
    return plan ? replaceCommentTerms(comment, plan.commentTerms) : comment;
  });
}

/**
 * Reports fake-domain vocabulary that remains in model-added comments after
 * deterministic term replacement. A future local/approved LLM adapter can
 * use this bounded list as its rewrite queue without receiving source code.
 */
export function findUnrehydratedCoverStoryTerms(
  text: string,
  plans: readonly CoverStoryPlan[],
): UnrehydratedCoverStoryTerm[] {
  const knownOriginalComments = new Set(plans.flatMap((plan) => [...plan.reverseComments.values()]));
  const results: UnrehydratedCoverStoryTerm[] = [];
  text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment) => {
    if (knownOriginalComments.has(comment)) return comment;
    const plan = selectCommentPlan(comment, plans);
    if (!plan) return comment;
    const rewritten = replaceCommentTerms(comment, plan.commentTerms);
    for (const term of plan.domain.vocabulary) {
      if (hasWord(rewritten, term)) results.push({ term, comment });
    }
    return comment;
  });
  return results;
}

/**
 * Applies an explicitly configured semantic adapter only to comments that
 * still contain known fake-domain vocabulary after deterministic rehydration.
 * Invalid or still-synthetic adapter output is discarded unchanged.
 */
export async function rehydrateUnresolvedCoverStoryComments(
  text: string,
  plans: readonly CoverStoryPlan[],
  adapter: CoverStoryCommentAdapter,
): Promise<string> {
  const knownOriginalComments = new Set(plans.flatMap((plan) => [...plan.reverseComments.values()]));
  return replaceCommentsAsync(text, async (comment) => {
    if (knownOriginalComments.has(comment)) return comment;
    const plan = selectCommentPlan(comment, plans);
    if (!plan) return comment;
    const unresolvedTerms = plan.domain.vocabulary.filter((term) => hasWord(comment, term) && !plan.commentTerms.has(term));
    if (unresolvedTerms.length === 0) return comment;
    let rewritten: string | null;
    try {
      rewritten = await adapter.rewriteComment(comment, { plan, unresolvedTerms });
    } catch {
      return comment;
    }
    if (!isCommentText(rewritten) || plan.domain.vocabulary.some((term) => hasWord(rewritten, term))) return comment;
    return rewritten;
  });
}

function outputComments(text: string, plan: CoverStoryPlan): string {
  let output = text;
  for (const [synthetic, original] of [...plan.reverseComments.entries()].sort(byKeyLength)) {
    output = output.split(synthetic).join(original);
  }
  return output;
}

function replaceExact(text: string, replacements: Map<string, string>): string {
  let output = text;
  for (const [synthetic, original] of [...replacements.entries()].sort(byKeyLength)) {
    output = output.split(synthetic).join(original);
  }
  return output;
}

function replaceQuotedStrings(text: string, replacements: Map<string, string>): string {
  let output = text;
  for (const [syntheticToken, originalToken] of [...replacements.entries()].sort(byKeyLength)) {
    const synthetic = syntheticToken.slice(1, -1);
    const original = originalToken.slice(1, -1);
    if (syntheticToken.startsWith('`')) {
      const staticParts = synthetic.split(/\$\{[^}]*\}/g).map(escapeRegExp);
      const templatePattern = `\`${staticParts.join('\\$\\{[^}]*\\}')}\``;
      output = output.replace(new RegExp(templatePattern, 'g'), () => originalToken);
      continue;
    }
    const escaped = escapeRegExp(synthetic);
    output = output.replace(new RegExp(`(['"\`])${escaped}\\1`, 'g'), (_match, quote: string) => `${quote}${original}${quote}`);
  }
  return output;
}

function replaceIdentifiers(text: string, replacements: Map<string, string>): string {
  let output = text;
  for (const [synthetic, original] of [...replacements.entries()].sort(byKeyLength)) {
    const escaped = escapeRegExp(synthetic);
    const pattern = synthetic.startsWith('#')
      ? `(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`
      : `\\b${escaped}\\b`;
    output = output.replace(new RegExp(pattern, 'g'), () => original);
  }
  return output;
}

function replaceCommentTerms(comment: string, replacements: Map<string, string>): string {
  let output = comment;
  for (const [synthetic, original] of [...replacements.entries()].sort(byKeyLength)) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(synthetic)}\\b`, 'g'), original);
  }
  return output;
}

function selectCommentPlan(comment: string, plans: readonly CoverStoryPlan[]): CoverStoryPlan | undefined {
  let selected: CoverStoryPlan | undefined;
  let bestScore = 0;
  for (const plan of plans) {
    let score = 0;
    for (const term of plan.commentTerms.keys()) {
      if (hasWord(comment, term)) score += 2;
    }
    for (const term of plan.domain.vocabulary) {
      if (hasWord(comment, term)) score += 1;
    }
    for (const synthetic of plan.reverseIdentifiers.keys()) {
      if (hasWord(comment, synthetic)) score += 4;
    }
    // Later plans win ties because they represent the most recent file in the
    // conversation, while a strict zero score leaves unrelated comments alone.
    if (score >= bestScore && score > 0) {
      selected = plan;
      bestScore = score;
    }
  }
  return selected;
}

function hasWord(text: string, value: string): boolean {
  return new RegExp(`\\b${escapeRegExp(value)}\\b`).test(text);
}

async function replaceCommentsAsync(
  text: string,
  rewrite: (comment: string) => Promise<string>,
): Promise<string> {
  const matches = [...text.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)];
  if (matches.length === 0) return text;
  const replacements = await Promise.all(matches.map((match) => rewrite(match[0])));
  let output = '';
  let cursor = 0;
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    output += text.slice(cursor, match.index) + replacements[index];
    cursor = (match.index ?? 0) + match[0].length;
  }
  return output + text.slice(cursor);
}

function isCommentText(value: string | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('//')) return !trimmed.includes('\n');
  return trimmed.startsWith('/*') && trimmed.endsWith('*/');
}

function collapseExpandedShorthand(text: string, replacements: Map<string, string>): string {
  let output = text;
  for (const original of replacements.values()) {
    const escaped = escapeRegExp(original);
    output = output.replace(new RegExp(`\\b${escaped}\\s*:\\s*${escaped}\\b`, 'g'), original);
  }
  return output;
}

function byKeyLength(left: [string, string], right: [string, string]): number {
  return right[0].length - left[0].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
