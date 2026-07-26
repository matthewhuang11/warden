import type { CoverStoryPlan } from '../obfuscate/coherentCoverStory.js';

export interface RehydrateCoverStoryOptions {
  includeAddedCommentTerms?: boolean;
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
  return options.includeAddedCommentTerms === false ? output : replaceAddedCommentTerms(output, plan.commentTerms);
}

export function rehydrateAddedCommentTerms(text: string, plan: CoverStoryPlan): string {
  return replaceAddedCommentTerms(text, plan.commentTerms);
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

function replaceAddedCommentTerms(text: string, replacements: Map<string, string>): string {
  return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment) => {
    let output = comment;
    for (const [synthetic, original] of [...replacements.entries()].sort(byKeyLength)) {
      output = output.replace(new RegExp(`\\b${escapeRegExp(synthetic)}\\b`, 'g'), original);
    }
    return output;
  });
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
