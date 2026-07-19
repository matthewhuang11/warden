# Stealth fixture corpus

These production-style examples exercise Warden against coherent business
logic without using real customer or company data. `fixture-manifest.json`
is the source of truth for corpus membership.

## Tuning set

- `fixtures/tuning/fintech/credit-line-policy.ts` evaluates revolving credit capacity.
- `fixtures/tuning/fintech/settlement-reserve.ts` sizes merchant settlement reserves.
- `fixtures/tuning/fintech/treasury-sweep.ts` retains operating liquidity before transfers.
- `fixtures/tuning/healthtech/care-gap-priority.ts` prioritizes overdue preventive care.
- `fixtures/tuning/healthtech/prior-authorization.ts` routes authorization requests.

The adversarial revise loop may read these files while proposing targeted
changes to Warden.

## Held-out set

- `fixtures/held-out/fintech/invoice-advance.ts` prices receivables financing decisions.
- `fixtures/held-out/healthtech/adherence-outreach.ts` recommends medication outreach.

The tuning loop must not read, embed, or select these files. They are used
only for the post-revision generalization check. Ordinary deterministic
tests may verify that they compile and round-trip correctly.

Run the business behavior and Warden round-trip checks with `npm test`.

The manual tuning harness requires explicit caps and a dedicated API key:

```bash
export WARDEN_STEALTH_MAX_RUNS=15
export WARDEN_STEALTH_MAX_BUDGET_USD=7.50
export WARDEN_STEALTH_TEST_API_KEY='your-dedicated-test-key'
npm run stealth:harness -- --all-tuning
```

`WARDEN_STEALTH_MAX_RUNS` caps reviewer/judge trial pairs for one
invocation. The total dollar cap is divided evenly across every reviewer
and judge call and passed through Claude's `--max-budget-usd` guardrail.

Use `--dry-run` to validate fixture selection and inspect the Claude CLI
arguments without requiring a key, starting processes, or making API calls.

Each completed trial is written immediately under `.warden/stealth-runs/`
as `metadata.json`, `response.txt`, `warden.log`, and `verdict.json`. The
verdict uses a fixed rubric and includes the exact triggering quote for a
suspicious result. The directory is private to the current user and ignored
by Git. Override it with `--output-dir <path>` when needed.

The judge is a consistency aid, not ground truth. Periodically inspect a
sample of `response.txt` and `verdict.json` pairs by hand, including clean
verdicts, to catch false positives and false negatives.

For a supervised smoke test, the harness can use a stored Claude CLI login
instead of a dedicated API key:

```bash
claude auth login
export WARDEN_STEALTH_MAX_RUNS=1
export WARDEN_STEALTH_MAX_BUDGET_USD=0.50
npm run stealth:harness -- --use-cli-auth --fixture examples/fixtures/tuning/fintech/credit-line-policy.ts
```

This mode still enforces the run, timeout, and budget-equivalent CLI caps,
but it does not isolate usage from the account's normal Claude activity. Use
it only for supervised checks; dedicated-key mode remains the default for a
multi-fixture unattended pass.

After a tuning-driven revision, evaluate generalization exactly once across
the complete held-out set:

```bash
export WARDEN_STEALTH_MAX_RUNS=2
export WARDEN_STEALTH_MAX_BUDGET_USD=1.00
npm run stealth:harness -- --use-cli-auth --all-held-out
```

Held-out fixtures cannot be selected individually or combined with tuning
fixtures. The harness forces one trial per held-out fixture and writes a
separate `held-out-pass` summary.
