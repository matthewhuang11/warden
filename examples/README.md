# Stealth fixture corpus

These production-style examples exercise Warden against coherent business
logic without using real customer or company data. `fixture-manifest.json`
is the source of truth for corpus membership.

## Tuning set

- `fixtures/tuning/fintech/credit-line-policy.ts` evaluates revolving credit capacity.
- `fixtures/tuning/fintech/settlement-reserve.ts` sizes merchant settlement reserves.
- `fixtures/tuning/healthtech/care-gap-priority.ts` prioritizes overdue preventive care.
- `fixtures/tuning/healthtech/prior-authorization.ts` routes authorization requests.

The adversarial revise loop may read these files while proposing targeted
changes to Warden.

## Held-out set

- `fixtures/held-out/fintech/treasury-sweep.ts` retains operating liquidity before transfers.
- `fixtures/held-out/healthtech/adherence-outreach.ts` recommends medication outreach.

The tuning loop must not read, embed, or select these files. They are used
only for the post-revision generalization check. Ordinary deterministic
tests may verify that they compile and round-trip correctly.

Run the business behavior and Warden round-trip checks with `npm test`.

The manual tuning harness requires explicit caps and a dedicated API key:

```bash
export WARDEN_STEALTH_MAX_RUNS=1
export WARDEN_STEALTH_MAX_BUDGET_USD=1.00
export WARDEN_STEALTH_TEST_API_KEY='your-dedicated-test-key'
npm run stealth:harness -- --fixture examples/fixtures/tuning/fintech/credit-line-policy.ts
```

`WARDEN_STEALTH_MAX_RUNS` caps Claude sessions for one invocation. The
total dollar cap is divided evenly across those sessions and passed to each
one through Claude's `--max-budget-usd` guardrail.

Use `--dry-run` to validate fixture selection and inspect the Claude CLI
arguments without requiring a key, starting processes, or making API calls.
