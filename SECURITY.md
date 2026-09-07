# Security policy

Warden is a research prototype and **must not be treated as a security boundary**.
It performs best-effort source transformation before Anthropic Messages API
requests leave the machine, but the README documents known detection and coverage
limits.

## Reporting vulnerabilities

If you find a vulnerability or a way Warden exposes data it claims not to expose,
please open a private security advisory on GitHub if available, or contact the
repository owner directly before publishing details.

Please include:

- the affected command or request shape,
- whether source text, identifiers, comments, literals, audit data, or dashboard
  sync data were exposed,
- reproduction steps using synthetic code only,
- expected versus actual behavior.

Do not include real secrets, customer data, or proprietary source in a report.

## Public data expectations

- `.warden/`, `.env*`, local reports, dependency directories, and build outputs
  are ignored.
- The optional dashboard sync path is intended to accept aggregate counts and
  pseudonymous labels only.
- API keys for evaluation harnesses should be dedicated, capped, and never shared
  with normal development credentials.
