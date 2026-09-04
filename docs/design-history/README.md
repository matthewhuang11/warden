# Design history

These are the working specs used during development, kept for context on how
the project evolved and why certain things exist. They were written as
instructions for coding agents (Codex, then Claude Code) at different points
in the project and are not all fully implemented as originally scoped — see
the top-level `README.md` for what actually shipped versus what stayed
partial or aspirational.

Rough chronological order:

1. `01-stealth-tightening-spec.md` — the first stealth pass: naming
   coherence per file/session, derived-constant redaction, a realistic
   fixture corpus, and an automated adversarial test loop (proxy → live
   Claude Code CLI → judge model → suspicion rate).
2. `02-stealth-final-spec.md` — a follow-up after the first pass found a
   real detection ("this reads like an auto-generated demo"): a scoped
   system-prompt injection plus semantic-role-aware naming, so a
   clamped/floored value doesn't get a name implying a raw one.
3. `03-analytics-dashboard-spec.md` — the local audit log / report / stats
   commands, plus the opt-in aggregate-only team dashboard.

See `.warden/stealth-runs/` (gitignored, local only) for the actual trial
transcripts and judge verdicts these specs produced.
