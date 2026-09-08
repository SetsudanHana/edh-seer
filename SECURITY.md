# Security policy

## Reporting a vulnerability

Please report privately rather than in a public issue.

Use GitHub's private reporting —
[**Report a vulnerability**](https://github.com/SetsudanHana/edh-seer/security/advisories/new) — which
opens a draft advisory only the maintainer can see.

There is no bounty. Expect an acknowledgement within a week, and a fix or an explanation of why it is
not one before the report is made public.

## What is in scope

- **The deployed site**, [edhseer.cards](https://edhseer.cards) — its Cloudflare Functions, its
  static assets, and the headers they are served with.
- **This repository** — the packages, the build, and the CI workflows.

The site takes no accounts, no payment, and stores nothing a visitor types. A pasted decklist is
analysed and discarded; there is no user data to breach. That shrinks the interesting surface to
roughly: a way to make the site serve something it did not author, a way to make CI run something it
should not, or a dependency with a known advisory.

## What is not a vulnerability

- **A wrong synergy claim.** That is a correctness defect and a welcome one —
  [report the edge](https://github.com/SetsudanHana/edh-seer/issues/new?template=wrong-edge.yml)
  in the open.
- **Missing hardening with no exploit path.** A recommendation is fine as a normal issue; it is not
  an advisory.
- **Card data being wrong.** Oracle text comes from Scryfall and MTGJSON; report it upstream.

## Dependencies

Dependabot is enabled, and CodeQL runs on every pull request and on `main`. If you are reporting a
known advisory in a dependency, please say whether the vulnerable path is actually reachable from
this code — that is the part that decides how fast it moves.
