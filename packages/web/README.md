# @edh-seer/web

The site at [edhseer.cards](https://edhseer.cards): paste a decklist, or a Moxfield or Archidekt link,
and get the synergy report.

- `client/` — Vite + React 19 + Tailwind 4. **In production it analyses in the browser**: built with
  `VITE_STATIC_DATA=1`, it reads each card's derived tags from `/static` shards and runs the matcher
  itself. Also holds the static How it works page and the card and commander page templates.
- `functions/` — Cloudflare Pages Functions that prerender the card, commander and browse pages.
- `server/` — a NestJS (Fastify) API that runs the same analysis against MongoDB. Development only:
  it is the known-good reference to compare the static path against, and the backend for the
  calibration panel. It is never deployed.
- `scripts/` — the deploy assembler, IndexNow, and the README and How it works screenshots and demo.

Deck links are imported by a separate Worker, [`packages/import-worker`](../import-worker), at
`/api/import/*`.

## Run

The site as production runs it (needs `static-out/`, built from MongoDB):

```bash
npx tsx packages/matcher/src/bin/build-static.ts
VITE_STATIC_DATA=1 npm run dev:client -w @edh-seer/web     # http://localhost:5173
```

The API path, against MongoDB directly:

```bash
docker compose -f packages/data/docker-compose.yml up -d   # MongoDB, loopback only
npm run ingest -w @edh-seer/data                            # once, populates Mongo
npm run dev -w @edh-seer/web                                # API :3001 + UI :5173, /api proxied
```

The [runbook](../../docs/RUNBOOK.md#running-the-product) has the rest, including the deploy.

## Notes on the stack

- The server is CommonJS (NestJS needs legacy decorator metadata, compiled by plain `tsc`; there is
  no Nest CLI). `@edh-seer/*` are ESM TypeScript-source packages, so the server loads them through
  tsx's loader (`start:server` = `node --import tsx dist/main.js`). It is the one CommonJS corner of
  the repository.
- Security headers (CSP, frame and permissions policy) are defined once in `client/src/lib/csp.ts`,
  sent by the Functions and mirrored in `client/public/_headers`; `csp.test.ts` holds them together.

## Test

```bash
npm run test:client -w @edh-seer/web                                          # component + integration tests
npm run test:server -w @edh-seer/web                                          # unit + e2e (Mongo suites skip)
MONGO_TEST_URI=mongodb://localhost:27017 npm run test:server -w @edh-seer/web # + Mongo integration
```
