# @edh-seer/web

The site at [edhseer.cards](https://edhseer.cards): paste a decklist, or a Moxfield or Archidekt link,
and get the synergy report.

- `client/` — Vite + React 19 + Tailwind 4. **It analyses in the browser**: it reads each card's
  derived tags from `/static` shards and runs the matcher itself, through `analyzeDecklist` in
  `@edh-seer/matcher/orchestrate`. Also holds the static How it works page and the card and
  commander page templates.
- `functions/` — Cloudflare Pages Functions that prerender the card, commander and browse pages.
- `scripts/` — the deploy assembler, IndexNow, and the README and How it works screenshots and demo.

There is no API server. There was a NestJS one, kept as a reference path for the browser analysis;
it was removed on 2026-09-25, and the one thing only it did -- the `#calibrate` pair-judging panel --
is served by the Vite dev server (`client/vite.config.ts`). Deck links are imported by a separate
Worker, [`packages/import-worker`](../import-worker), at `/api/import/*`.

## Run

```bash
npx tsx packages/matcher/src/bin/build-static.ts     # static-out/, from MongoDB, ~70s
npm run dev -w @edh-seer/web                         # http://localhost:5173, /static from static-out/
MTG_CALIBRATE=1 npm run dev -w @edh-seer/web         # the same, with /#calibrate answering
```

The [runbook](../../docs/RUNBOOK.md#running-the-product) has the rest, including the deploy.

## Notes on the stack

- The package is ESM like every other one (`"type": "module"`), which it could not be while the
  NestJS server needed CommonJS and legacy decorators.
- Security headers (CSP, frame and permissions policy) are defined once in `client/src/lib/csp.ts`,
  sent by the Functions and mirrored in `client/public/_headers`; `csp.test.ts` holds them together.

## Test

```bash
npm test -w @edh-seer/web          # component, integration and page tests
```
