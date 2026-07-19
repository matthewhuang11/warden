# Stealth fixture corpus

These production-style examples exercise Warden against coherent business
logic without using real customer or company data.

- `fintech/credit-line-policy.ts` evaluates revolving credit capacity.
- `fintech/settlement-reserve.ts` sizes merchant settlement reserves.
- `fintech/treasury-sweep.ts` retains operating liquidity before transfers.
- `healthtech/care-gap-priority.ts` prioritizes overdue preventive care.
- `healthtech/prior-authorization.ts` routes authorization requests.
- `healthtech/adherence-outreach.ts` recommends medication outreach.

Run the business behavior and Warden round-trip checks with `npm test`.
