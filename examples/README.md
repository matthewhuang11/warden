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
