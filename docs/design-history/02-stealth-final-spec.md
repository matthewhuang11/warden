# Warden: Stealth — Final Spec

This is the last stealth-focused spec, meant to close out the naming/stealth work. It's written for **Claude Code**, not Codex — earlier passes (the hardening spec, and the first stealth tightening spec covering naming coherence, derived-constant redaction, the fixture corpus, and the automated adversarial test loop) were done via Codex, whose usage is nearly exhausted. Claude Code was not part of those sessions and has no memory of what was actually implemented versus just planned.

**Before doing anything else: read the actual current state of the codebase.** Do not assume any item from the earlier hardening spec or the first stealth spec is done just because it was written down — check the code and the test suite directly. Report what you find already implemented versus still open before starting on the two items below.

---

## A definition worth being precise about, since it's caused confusion across this project

There are two different things that can happen when a coding agent reads Warden-proxied code, and they are not the same problem:

1. **Suspecting fakery** — the agent says something like "this reads like a deliberately obfuscated or auto-generated demo rather than real business logic." This is a real stealth failure and matters.
2. **Ordinary naming-quality feedback** — the agent says something like "these two variable names don't quite match what they compute." This happens on real, unredacted, human-written code constantly. It is not evidence the agent has detected obfuscation, and treating every naming nitpick as a stealth failure is chasing an unwinnable and not-actually-meaningful bar.

The two items below target category 1 and the specific mechanism that produces category 2 — not "make the agent never comment on any name ever," which would cost real product value for no real gain.

---

## Agent instructions — read before touching any code

- Work in `/Users/matthew_h/Programming Projects/warden`. Read existing test files first and match conventions for anything new.
- Do the two items in order. Rebuild and run the full test suite after each. Stop and report back after each one before continuing.
- Do not set `ANTHROPIC_AUTH_TOKEN` to `"dummy"`.
- If either item turns out to already be partially handled by something Codex built, say so and adapt rather than duplicating or overwriting it blindly.

---

## Item 1 — scoped system-prompt injection (ship this first, it's cheap)

Add a fixed, invisible instruction that the proxy injects into every outbound request (system-level, not visible to the user), scoped narrowly:

> Don't proactively volunteer opinions about whether identifier or variable names accurately reflect their behavior, unless the user explicitly asks for a naming, readability, or code-quality review.

This is deliberately **not** "ignore naming issues" or "don't discuss naming ever." It needs to still allow a real, honest answer if a developer directly asks "are these names any good" or "review this file for readability" — killing that would remove a legitimate, useful capability for every session, not just the ones involving cover-story naming. The goal is to suppress unprompted commentary specifically, not the topic generally.

**Tests to add:**
- A task-completion prompt (e.g. "add a field to this struct and update the calculation") against a fixture with intentionally imperfect cover-story names should not produce unprompted naming commentary in the response.
- An explicit prompt ("review this code's naming for clarity") against the same fixture should still produce honest, specific feedback — confirming the injection doesn't accidentally suppress a legitimate direct request.

## Item 2 — semantic-role-aware naming (the real fix behind item 1)

The actual bug behind the naming-nitpick example that prompted this spec: a variable computed as `Math.max(0, x - y)` (a floor/clamp) was given a name implying a raw, unclamped value, and a subtraction remainder was named as if it were a direct value. The mismatch wasn't about the naming *theme* — it was that the fake name didn't match the variable's actual computational role.

Extend the naming generator to classify each identifier's computational role from its AST context before assigning a replacement name — at minimum distinguish: a direct pass-through/parameter, a clamped or floored/ceiling-bounded value, an arithmetic difference or remainder, a boolean gate/condition result, and an accumulator. Assign replacement names (within whatever cover-story theme is already chosen for the file/session) that reflect that role — e.g. a clamped value should read as clamped/bounded in the fake domain too, not as a raw quantity.

**Tests to add:** for each of the role categories above, redact a fixture containing that pattern and assert the assigned name doesn't imply a different computational role than the one actually present (e.g. a clamp-producing expression should never receive a name implying an unbounded raw value).

---

## Sequencing and what happens after this

Do item 1 first — it's fast and directly addresses what a human reviewing a transcript would actually see. Item 2 is the durable fix and should follow immediately after, since it removes the underlying cause rather than just suppressing its visibility.

Once both are done, stealth work is closed for this pass. Any further tuning should go through the automated adversarial test loop already specified in the first stealth spec (real Claude Code CLI session + judge pass + held-out fixture set) rather than another ad hoc spec — that loop is the right mechanism to verify these two fixes actually held up under repeated, varied testing, not just against the one example that prompted this.
