import type { SyntheticMapper } from './syntheticMapper';

/**
 * Replaces any known synthetic tokens in `text` with their real values.
 * Exact-string match only -- a token the model paraphrases or reformats
 * won't be caught; that's an accepted MVP limitation.
 */
export function rehydrate(text: string, mapper: SyntheticMapper): string {
  if (!text || mapper.size === 0) return text;

  let result = text;
  for (const token of mapper.tokens) {
    if (result.includes(token)) {
      const real = mapper.reveal(token);
      if (real !== undefined) {
        result = result.split(token).join(real);
      }
    }
  }
  return result;
}

/**
 * Walks all text nodes under `root` and rehydrates any synthetic tokens found
 * in place. Intended to run from a MutationObserver callback watching an
 * LLM's streaming response container.
 */
export function rehydrateDom(root: Node, mapper: SyntheticMapper): void {
  if (mapper.size === 0) return;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  const tokens = mapper.tokens;
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const original = node.nodeValue;
    if (!original) continue;
    if (!tokens.some((t) => original.includes(t))) continue;
    const revealed = rehydrate(original, mapper);
    if (revealed !== original) node.nodeValue = revealed;
  }
}
