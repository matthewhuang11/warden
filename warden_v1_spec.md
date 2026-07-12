# Warden — v1 Product & Technical Spec

**Tagline:** Privacy, before you hit send.

## 1. Problem (context, not a build task)
Consumer-tier AI chat platforms (ChatGPT, Claude, Gemini) can retain, train on, and internally review conversation content by default. Existing opt-out settings only cover future training use — they don't stop retention for abuse/legal purposes, don't undo already-collected data, and don't prevent contractor review or inference-based classification. There is currently no way to stop sensitive content from reaching a platform's servers in the first place on the free/consumer tier.

## 2. v1 Goal
A browser extension that detects likely-sensitive content in a user's message **before it's sent** to an AI chat platform, warns the user, and optionally substitutes that content with placeholder tokens — reversing the substitution when the AI's response comes back. All detection and substitution happens **entirely client-side, with zero network calls**. This local-only property is the core trust claim and must be independently verifiable (e.g., works with the network tab showing no outbound requests during detection/substitution).

## 3. Explicitly OUT of scope for v1
- Management/audit dashboard (view/export/delete data platforms already retain) — planned v2
- On-device NER model / ML-based detection of names, addresses, unstructured entities — planned v2 (v1 is regex-only)
- Monitoring for platform policy/default changes — v2
- Mobile support, Firefox/Safari — Chrome (Manifest V3) only for v1
- Any use of a cloud AI/LLM API for detection (would defeat the privacy premise)
- Encryption/FHE, agent authentication, quantum-related research — separate threads, not part of this build

## 4. Supported sites for v1
- chatgpt.com (ChatGPT)
- claude.ai (Claude)
- gemini.google.com (Gemini)

Note for implementation: exact DOM selectors for the input box, send button, and response container must be verified against the live sites at build time (they may not match assumptions below and can change without notice — build selector logic to fail gracefully/disable itself on that site rather than break the page if a selector isn't found).

## 5. Core user flow
1. User types a message into the AI platform's normal input box, no change to their workflow.
2. Before the message is sent (intercept the send action — button click and Enter-key submit), Warden's detection engine scans the current text.
3. If nothing sensitive is detected: message sends normally, no interruption.
4. If sensitive content is detected: show a small inline banner above the input box:
   - Text: "This message includes [category list, e.g. an email and a phone number]. Send as-is, or clean it up first?"
   - Two buttons: **Send as-is** / **Clean up & send**
5. If "Clean up & send": replace each detected sensitive span with a placeholder token (see §7), send the sanitized text, keep the original values in an in-memory session map.
6. When the platform's response streams in, scan the response text for placeholder tokens and replace them with the original real values before the user sees the final rendered response.
7. If "Send as-is": send the original message unmodified, no further interruption for this message.

## 6. Detection engine (v1 = regex only, no ML model)
Implement as a standalone, pure-function module (no DOM/browser dependencies) so it's independently testable.

Categories and starter patterns:
- **Email address** — standard email regex
- **Phone number** — US formats (xxx-xxx-xxxx, (xxx) xxx-xxxx, xxx.xxx.xxxx) plus generic international `+` prefix pattern
- **SSN** — xxx-xx-xxxx format
- **Credit card number** — Visa/Mastercard/Amex/Discover prefix + length patterns, optionally Luhn-checksum validated to reduce false positives
- **IP address** — IPv4 pattern

Each match should return: `{ type: string, value: string, startIndex: number, endIndex: number }`.

Design for extensibility: store patterns in a single config object/array so new categories can be added without touching the matching logic. Include a settings option (v1 nice-to-have, not required) to let the user add a custom regex pattern (e.g., an employee ID format).

## 7. Tokenization mechanism
- On detection, replace each matched span with a placeholder: `[EMAIL_1]`, `[PHONE_1]`, `[SSN_1]`, `[CARD_1]`, `[IP_1]` — numbered sequentially per message.
- Maintain a mapping table (token → original value) **in memory only**, scoped to the current browser tab/session. Do not persist to disk/localStorage. Clear on tab close or when the conversation/page is navigated away from.
- On response reveal: scan incoming response text for any known token strings from the current session's map and replace with original values.
- Edge case to handle: if the AI response references a token in a modified form (e.g., pluralized or reformatted), exact-string matching will miss it — acceptable known limitation for v1, don't over-engineer this.

## 8. UI components
- **Inline warning banner**: injected into the page near the input box, dismissible, non-blocking (doesn't prevent the user from just clicking send again if they choose "Send as-is").
- **Extension popup** (click the toolbar icon): 
  - On/off toggle for Warden overall
  - Per-site on/off toggle
  - Simple counter: "X items protected this session" (builds trust/visibility, cheap to implement)
  - Link to a basic settings page (custom regex patterns, if included)
- **Visual mark**: use 🛡️ as the icon/favicon motif per existing branding.

## 9. Technical architecture (Chrome Manifest V3)
- `manifest.json` — Manifest V3, content scripts scoped to the three supported site URL patterns, minimal permissions (avoid requesting broad host permissions beyond the three target sites).
- `content-script.js` (per site, or one script with site-detection branching) — 
  - locates the input element and send control for that site
  - intercepts submit (both click and Enter-key paths)
  - calls the detection module
  - renders the warning banner
  - handles the tokenize-and-send flow
  - observes the DOM (MutationObserver) for new response content to run the reveal step
- `detection.js` — pure regex detection module, no dependencies, unit-testable in isolation
- `tokenizer.js` — handles substitution and reveal, owns the in-memory session map
- `popup.html` / `popup.js` — extension toolbar popup UI
- No background service worker should be needed for v1 unless cross-tab state is required (it shouldn't be — keep state tab-scoped).
- **Hard constraint: no `fetch`/`XMLHttpRequest`/any network call anywhere in the detection or tokenization code path.** This should be checkable by code review/grep, not just tested behaviorally.

## 10. Acceptance criteria for v1 "done"
- On all three supported sites, typing a message containing at least one of the five detection categories triggers the warning banner before send.
- "Clean up & send" results in the platform receiving only the tokenized version (verifiable by inspecting the network request payload).
- The platform's response, once it streams in, displays with real values restored in place of any tokens.
- With the browser in offline/airplane mode, the detection-and-tokenize cycle still completes successfully with no errors (proving no network dependency).
- Toggling Warden off via the popup fully disables banner injection on next page load.
- No sensitive value is ever written to disk, localStorage, or any persistent storage.

## 11. Suggested build order
1. Extension skeleton + manifest, confirm it loads unpacked in Chrome
2. Detection module + unit tests against sample strings (no browser needed for this step)
3. Content script on ChatGPT only: locate input/send elements, intercept submit, log detected matches to console (no UI yet)
4. Add warning banner UI + Send as-is / Clean up & send buttons
5. Implement tokenize → send → reveal flow end-to-end on ChatGPT
6. Extend to Claude and Gemini (expect different selectors per site)
7. Build popup UI (toggle, counter, settings link)
8. Manual test pass: airplane-mode verification, all five detection categories, toggle on/off behavior
