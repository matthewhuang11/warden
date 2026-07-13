# Warden

**Privacy, before you hit send.**

Warden is a Chrome extension (Manifest V3) that locally detects sensitive entities in your prompts to ChatGPT and Claude — names, company names, dollar amounts, emails, phone numbers, SSNs — and swaps them for realistic synthetic placeholders (`John Smith` → `Candidate_Alpha`, `Stripe` → `Company_1`, `$450,000` → `$420,000`) *before* the request leaves your browser. When the model's response streams back in, any placeholders it echoes are rehydrated to the real values on screen.

**Zero cloud leak:** detection and substitution run entirely in-browser. There is no `fetch`/`XMLHttpRequest`/network call anywhere in the engine's code path — grep `src/` yourself to confirm.

## Stack

Manifest V3 · TypeScript (strict) · Vite + [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin) · React + Tailwind (popup/overlay) · Jest for the pure engine modules.

## Project layout

```
manifest.json
src/
  background/
    background.ts       service worker: badge count, default settings init
    settingsStore.ts     chrome.storage.local wrapper (toggles only, never PII)
  content/
    contentScript.ts     intercepts submit, runs the engine, rehydrates responses
    domAdapters/          per-site selectors (ChatGPT, Claude) with graceful fallback
    uiOverlay.tsx         floating "🛡️ N redacted" badge + pause/resume
  engine/
    anonymizer.ts         orchestrator: regex PII + heuristic name/org detection
    regexScanner.ts       email / phone / SSN / exact dollar-amount patterns
    syntheticMapper.ts    bidirectional real <-> synthetic token map (in-memory only)
    rehydrator.ts          swaps synthetic tokens back to real values
  popup/
    Popup.tsx             global toggle, per-site toggle, session counter, mapping table
  types/index.ts          shared interfaces
tests/                    Jest unit tests for every engine/adapter module
```

## Setup

```
npm install
```

## Load it in Chrome

The engine is TypeScript/JSX, so it needs a build step (unlike a plain-JS extension) — point Chrome at `dist/`, not the project root.

```
npm run build
```

Then:
1. Go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder produced above.

For active development with hot reload, `npm run dev` starts Vite in watch mode against the same unpacked-extension flow — reload the extension in `chrome://extensions` after the first build, then CRXJS handles most subsequent updates automatically.

## Testing

```
npm test        # Jest — engine + adapter unit tests (pure functions, no chrome.* deps)
npm run typecheck  # strict TypeScript across the whole project
```

## Known MVP limitations

- Name/org detection is a **heuristic** (capitalized-phrase runs + a small org-suffix/gazetteer list), not true NER — expect some false positives/negatives. Swapping in an in-browser NER model is the natural v2 upgrade.
- Site selectors in `domAdapters/` are best-effort against ChatGPT's and Claude's current DOM and may drift as those SPAs change; each adapter tries multiple fallback selectors and logs a `[Warden] Could not find...` console warning rather than breaking the page if none match.
- Rehydration is exact-string match only — a paraphrased or reformatted token in the model's response won't be caught back.
- No persistent storage of any detected/real value at any point — the mapping table lives only in the content script's memory for that tab and is cleared on navigation to a new conversation or tab close.
