# Warden: Stealth Tightening + Automated Adversarial Testing Spec

Separate, standalone spec from the hardening spec and the analytics/dashboard spec. This one is triggered by a real finding: when a coding agent was pointed at a Warden-proxied demo file, its own analysis noted the naming "reads like a deliberately obfuscated or auto-generated identifier-naming demo rather than real business logic" — a live example of the exact failure mode that matters most, the downstream AI noticing that something's been renamed. This spec covers (1) fixing what that specific finding actually revealed, and (2) building an automated loop where Codex tests Warden against a real Claude Code CLI session and keeps revising until the naming holds up under scrutiny, not just under a single manual check.

---

## Agent instructions — read before touching any code

- Work in `/Users/matthew_h/Programming Projects/warden`. Read the existing test files first and match conventions for anything new.
- Do one numbered item at a time, in section order (I, then II, then III, then IV woven in from the start of III). Rebuild and run the full suite after each item. Stop and report back after each one — don't chain items without a check-in.
- **Before writing any fix, first determine whether the original finding happened with the coding agent actually routed through the Warden proxy (`ANTHROPIC_BASE_URL` pointed at it) or reading the file directly.** These are different bugs with different fixes. Report which one it was before proceeding to item 2.
- **Cap API spend.** Any item involving live calls to a coding agent CLI must use a dedicated test API key (not the main development key) and must have an explicit call/cost cap before it runs unattended. Never remove or raise a cap without asking first.
- **Never fix a failing stealth test by weakening the test itself.** If a fixture is flagged as detected, the fix is to improve the naming/redaction logic — not to simplify the fixture's business logic, not to hard-code special-case handling for that one fixture's exact content. If you're ever about to do either of those, stop and flag it instead.
- If an assumption below turns out wrong (e.g., the finding wasn't actually proxied, or coherence is already handled somewhere), say so — don't silently route around it.

---

## I. Diagnose and fix the immediate finding

1. **Confirm whether the flagged analysis was proxied.** Instrument the proxy so it's never ambiguous again: print or log a visible marker on every intercepted request/response (e.g., a line showing N identifiers were substituted for this exchange), so any future transcript makes it immediately obvious whether Warden was actually in the loop. Report which case the original finding was before moving on.
2. **Fix naming coherence.** The likely real bug: replacement identifiers are currently chosen independently of each other, so a file can end up with some names that still read as business-domain-coherent (`CustomerRenewalRecord`, `RENEWAL_PROCESSING_FEE`) sitting next to others that don't, which is itself a tell. Change the naming generator to pick one consistent fake theme per file (or per session) up front, and map every identifier within that scope into the same theme — not name-by-name in isolation. Add a test that redacts a whole realistic fixture and asserts all replacement names share a consistent register/theme, not just that each one individually looks generic.
3. **Extend redaction to derived constants that encode business meaning through computation, not just naming.** A constant like a fee value computed from the length of a business-descriptive string is itself a leak — the business meaning is embedded in the derivation, not the identifier. Detect and redact these, not just plain identifier names. Add a regression test.

---

## II. Build a real fixture corpus (the current one is the other likely culprit)

4. **Replace the single demo file with a small corpus** (5-8 files) of realistic, internally-coherent proprietary-style business logic across at least two domains (e.g., fintech and healthtech). Write it carefully enough that a knowledgeable reviewer would find it plausible as real production code — no nonsensical placeholder logic like deriving a fee from an unrelated string's length. If the current `identifier-demo.ts` file itself is the thing that reads as synthetic, rewrite it as part of this item rather than treating it as untouchable.
5. **Split the corpus into a tuning set and a held-out set.** The automated loop in Section III may only read/use the tuning set while iterating. The held-out set is never touched during iteration and exists purely to catch the loop overfitting fixes to the exact fixtures it was trained against.

---

## III. Automated adversarial test loop

6. **Build a test harness script** that: starts the Warden proxy fresh, starts a real Claude Code CLI session configured to route through it (real dedicated test API key, never the `"dummy"` token), and feeds it a realistic task against one tuning-set fixture (e.g., "review this file and suggest an improvement," or "add a field and update the calculation").
7. **Capture the full response text** from each run, plus whatever Warden's own log shows was substituted for that exchange.
8. **Build a judge pass.** A separate model call with a fixed rubric prompt: does this response show any sign — explicit or implicit — that the assistant suspects the identifiers are artificial, inconsistent, auto-generated, or otherwise not representative of real production code? Return yes/no plus the exact quoted phrase if yes. Log every verdict next to the original response. The judge is not infallible — spot-check a sample of its verdicts by hand periodically rather than trusting it blindly.
9. **Run each fixture multiple times per pass, minimum 3 trials, not once.** Model output is non-deterministic — a single clean run doesn't prove stealth, and a single flagged run doesn't necessarily mean systemic failure. Track a suspicion rate per fixture, not a binary pass/fail.
10. **Wire a bounded revise loop.** When a fixture's suspicion rate exceeds a set threshold, propose and apply one specific, targeted change to the naming/redaction logic — not a blanket rewrite — then re-run the same trial count to check whether it helped. Cap total iterations (e.g., 10) and stop for a human check-in at the cap rather than continuing unattended.
11. **Run the held-out set once after any tuning-driven revision** and report its suspicion rate honestly, even if it's worse than the tuning set's. That gap is the real signal for whether a fix generalized or just overfit to the fixtures it was tuned against.

---

## IV. Guardrails (apply from the start of Section III, not bolted on after)

12. Cap total spend for the test harness (agree a concrete number before running — e.g. a fixed dollar cap or a fixed call count, whichever comes first) and use a separate API key so this cost is visible independent of normal development usage.
13. Keep the harness itself a simple script, not new service infrastructure — it's meant to be run manually when tuning stealth, not a always-on CI system at this stage.

---

## Sequencing note

Do Section I first — it's the concrete fix for the specific finding that triggered this spec. Section II second, since the automated loop in Section III is only as good as the fixtures it tests against. Build the guardrails in IV into III as it's built, not as an afterthought once the loop already runs unattended.
