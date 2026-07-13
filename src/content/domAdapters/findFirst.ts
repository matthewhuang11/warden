/**
 * Tries each selector in order, returning the first element found. Each
 * adapter passes a list of fallback selectors since these are all
 * actively-changing SPAs -- an unpacked selector should never crash the
 * page, just fail to find that particular element.
 */
export function findFirst(selectors: string[], scope: ParentNode = document): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const el = scope.querySelector<HTMLElement>(selector);
      if (el) return el;
    } catch {
      // Unsupported/invalid selector in this context -- try the next one.
    }
  }
  return null;
}
