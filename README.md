# Warden

**Privacy, before you hit send.**

Warden is a Chrome extension that detects likely-sensitive content in your messages to AI chat platforms and lets you redact it *before* it ever leaves your browser. Detection and substitution are 100% local — no `fetch`, `XMLHttpRequest`, or any other network call exists anywhere in the detection/tokenization code path (verifiable by code review or by using the extension in airplane mode).

Supported sites (v1): [chatgpt.com](https://chatgpt.com), [claude.ai](https://claude.ai), [gemini.google.com](https://gemini.google.com).

See [`warden_v1_spec.md`](warden_v1_spec.md) for the full product/technical spec this build implements.

## How it works

1. You type a message as normal into ChatGPT, Claude, or Gemini.
2. Before it sends, Warden scans the text for emails, phone numbers, SSNs, credit card numbers, and IP addresses (regex-only, no ML, no cloud calls).
3. If something is found, a banner appears above the input box: **Send as-is** or **Clean up & send**.
4. **Clean up & send** replaces each match with a placeholder token (e.g. `[EMAIL_1]`), sends the sanitized text, and keeps the real values in an in-memory map scoped to that tab.
5. When the AI's response streams in, any placeholder tokens it echoes back are swapped back to the real values before you see them.
6. Nothing is ever written to disk, localStorage, or any persistent store — the map lives only in JS memory and is cleared on tab close or when you navigate to a new conversation.

## Project layout

```
manifest.json          Manifest V3 config
src/
  settings.js           chrome.storage.local wrapper (on/off toggles, custom patterns)
  detection.js           pure regex detection engine (no DOM/network deps)
  tokenizer.js            in-memory session map: tokenize + reveal
  sites.js                 per-site selector config with fallback lookup
  banner.js                inline warning banner component
  banner.css
  content-script.js       wires the above together against the live page
popup/                  toolbar popup (on/off, per-site toggle, session counter)
options/                settings page (custom regex patterns + a local test tool)
icons/                  generated shield-motif toolbar icons
tests/                  Jest unit tests for the pure modules
```

## Load it in Chrome

1. Run `npm install` once (only needed for the test suite, not for the extension itself).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this project's root folder (the one containing `manifest.json`).
5. Pin the Warden icon (🛡️) to the toolbar if you'd like quick access to the popup.

There's no build step — the extension runs directly from source.

## Running the unit tests

```
npm install
npm test
```

39 tests cover `detection.js`, `tokenizer.js`, `sites.js`, and the banner's text-formatting helper — the parts of the codebase that are pure functions independent of the DOM or `chrome.*` APIs, per the spec's testability requirement. `content-script.js`, the popup, and the options page are DOM/extension-API dependent and are exercised via the manual test pass below instead.

## Manual test checklist

Selectors for each site's input box / send button / response container are best-effort and may drift as these are all actively-changing SPAs — if Warden doesn't trigger on a site, open the console and look for a `[Warden] Could not find...` warning; the extension is designed to disable itself gracefully rather than break the page. Re-check `src/sites.js` selectors against the live DOM if that happens.

- [ ] On each of chatgpt.com, claude.ai, and gemini.google.com: type a message containing an email, phone number, SSN, credit card number, or IP address, and confirm the warning banner appears before send.
- [ ] **Clean up & send**: confirm (via the browser Network tab / request payload) that only the tokenized text reaches the platform's servers.
- [ ] Confirm the AI's response renders with the real value restored in place of any token it echoes back.
- [ ] With the browser offline (airplane mode / DevTools "Offline"), confirm the detect → tokenize → send-tokenized-text → reveal cycle still completes with no errors.
- [ ] Toggle Warden off in the popup, reload the page, and confirm the banner no longer appears.
- [ ] Toggle an individual site off in the popup, reload that site, and confirm Warden is inactive there while still active on the other two.
- [ ] Send a message with no sensitive content and confirm it goes straight through with no interruption.
- [ ] Confirm the popup's "items protected this session" counter increments on **Clean up & send** and resets on navigating to a new conversation.
- [ ] Add a custom pattern in the options page (e.g. an employee ID format) and confirm it's detected alongside the built-in categories.
- [ ] Inspect `chrome.storage.local` in DevTools and confirm it only ever contains settings (toggles, custom patterns) — never message content or detected values.
