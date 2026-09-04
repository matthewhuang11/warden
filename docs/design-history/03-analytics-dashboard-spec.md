# Warden: Analytics + Dashboard Spec

This is a separate, standalone spec from the earlier hardening spec. Feed this to Codex on its own once the P0–P3 hardening items are through. It covers the visual/analytics layer: a local redaction log/report (ship this first, no network) and a synced team dashboard (build the skeleton now, but scope it tight).

---

## Agent instructions — read before touching any code

- Work in `/Users/matthew_h/Programming Projects/warden` for Part A. Part B is a **new sibling folder in the same repo** (see Architecture below) — do not add it inside the existing proxy package's source tree.
- Before writing code, find and read the existing test files to learn the project's conventions (framework, layout, naming, fixture style) and match them for anything new.
- Do one numbered item at a time, in order, within a Part. Do not start the next item until the current one is fully done.
- "Done" means: implemented, rebuilt (never trust a hot reload), full test suite passing including new tests written in the existing style, and — for anything in Part B — the data-minimization rule below verified by an actual test, not just a code review.
- **Stop and report back after finishing each item.** Summarize what changed, test count/pass status, and anything that contradicts an assumption below. Wait for go-ahead before continuing.
- If an item is already partly done, or an assumption doesn't match the codebase, stop and flag it instead of guessing.

**Hard rule, non-negotiable, applies to every item in Part B:** the only things ever allowed to leave a developer's machine are aggregate counts, category labels, timestamps, and one-way hashes of redacted values. Real identifier names, comments, code strings, file contents, or the RenameMap itself must never appear in any network request the dashboard sync makes. Enforce this with a typed payload schema the sync code must go through — not just a convention — and write a test that asserts the schema rejects/strips anything resembling plaintext source. This is the one thing that, if it leaks, invalidates the entire product's pitch.

---

## Architecture decision (already made — build to this, don't relitigate it)

**Part A — local view.** No network calls, no new app. Lives inside the existing `warden-proxy` package, same repo, same folder structure it already has. It's just another local view of data the proxy already has.

**Part B — synced team dashboard.** A genuinely separate application: its own `package.json`, its own deploy target, independent of the proxy's release cycle. Put it in a new sibling folder at the repo root, e.g. `warden/dashboard/`, structured the same way the existing landing page is already separate from the proxy (own Next.js app, own Vercel deployment). Do not merge its code into the CLI proxy's source. The proxy only ever talks to it over an explicit, opt-in sync call — the proxy has zero dependency on the dashboard existing, and must work exactly as it does today with the dashboard turned off.

---

## Part A — local redaction log & report (build first)

1. **Live terminal stats panel.** Extend the existing per-request output lines into a running tally shown during a session: counts by category (identifiers, comments, strings, secrets). Update in place, don't just append endless lines. No new dependencies needed unless a TUI library materially simplifies this — if so, pick the lightest option and say which you chose and why.
2. **Local structured audit log.** Append-only, per-repo, local file recording for each redacted item: category, a one-way hash of the original value (never the plaintext), timestamp. Encrypt at rest using the same approach already used for the RenameMap. This is the data source for both the report below and, later, the dashboard sync.
3. **`warden report` command.** Generates a static local HTML file from the audit log and opens it in the browser — no server process required beyond generating the file. Content: totals by category, a timeline, and a plain-language summary line ("N identifiers, M comments, and P strings were transformed before transmission across X sessions between [dates]; 0 instances of unprotected proprietary identifiers detected"). This is the artifact meant to be handed to someone non-technical (GC, security lead), so keep the language plain, not developer-jargon.
4. **`warden stats` command.** Same data as the report, printed as a quick terminal summary — for someone who just wants the numbers without opening a browser.

Ship and verify all four before starting Part B.

---

## Part B — synced team dashboard (build the skeleton, scope tight)

5. **Scaffold the sibling app** at `warden/dashboard/`. Next.js, matching the stack conventions already established on the landing page (Tailwind, same type stack — Space Grotesk/Inter/JetBrains Mono — for visual consistency with the rest of the brand). Own `package.json`, deployable independently to Vercel.
6. **Define the sync payload schema first, as code, before writing any UI.** A typed contract for exactly what a proxy instance is allowed to send: aggregate counts by category, a pseudonymous repo/session label (not a real repo path unless the user explicitly names it), timestamps, and hashes. Write the test described in the hard rule above against this schema before building anything on top of it.
7. **Minimal backend for the dashboard.** One API endpoint to receive sync payloads, one datastore (SQLite is fine to start — don't over-engineer this before there's a real team using it), and simple per-org auth: an API key or token generated via a CLI setup step (`warden connect <org-token>`), not a full user-account system yet.
8. **Dashboard UI.** Org-level view: coverage over time, counts by category and by repo/developer, and an export that reuses Part A's report renderer against synced data instead of the local log. Keep it to one screen — a table/summary view, not a multi-page app — until there's a real customer asking for more.
9. **Sync must be opt-in and off by default.** The proxy never syncs anything until a developer explicitly runs the connect step. Verify with a test that a fresh install makes zero network calls beyond talking to Anthropic's API.
10. **Update the README and landing page copy** to state precisely what syncs and what doesn't: free/solo tier makes zero network calls beyond the AI provider; team tier syncs only counts and hashes, never code. This has to stay literally true, not just directionally true — it's the exact claim a skeptical security reviewer will test first.

---

## Sequencing note

Part A is small, ships fast, and is useful on its own even if Part B never gets built — prioritize it. Part B's goal for now is a working skeleton (schema enforced, opt-in, one basic dashboard screen), not a production multi-tenant system. Don't let auth/billing/multi-org polish creep into this pass.
