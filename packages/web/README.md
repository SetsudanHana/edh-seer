# @edh-seer/web

Local test UI for the MTG synergy engine. Paste a decklist, get a synergy report.

- `server/` — NestJS (Fastify) API. `POST /api/analyze { decklist }` → `{ report, missing, resolvedCount, totalCount }`.
- `client/` — Vite + React 19 + HeroUI 3 (Tailwind 4) frontend.

## Run

```bash
docker compose -f packages/data/docker-compose.yml up -d   # MongoDB (or: docker run -d -p 27017:27017 mongo:7)
npm run ingest -w @edh-seer/data                                # once, populates Mongo
npm run dev -w @edh-seer/web                                    # Nest :3001 + Vite :5173 together
```

Open http://localhost:5173, paste a decklist (plain text, `1 Card Name` per line — e.g. a
Moxfield **text export**), click Analyze. The Vite dev server proxies `/api` to Nest.

Moxfield URLs are not supported (Moxfield blocks server-side API access); use the text export.

## Notes on the stack

- The server is CommonJS (NestJS, decorator metadata via `tsc`), but `@edh-seer/engine`/`@edh-seer/data`
  are ESM TypeScript-source packages. So the server loads them via dynamic `import()` and runs
  under tsx's loader (`start:server` = `node --import tsx dist/main.js`,
  `dev:server` = `NODE_OPTIONS="--import tsx" nest start --watch`). A future "build the libraries
  to JS" cleanup would remove the tsx-loader runtime dependency.
- HeroUI 3 has no `HeroUIProvider`; components render directly. `@edh-seer/web` uses `vitest` 4
  (Vite 8 requirement) while the other packages use `vitest` 1 — isolated per package.

## Test

```bash
npm run test:server -w @edh-seer/web                                          # unit + e2e (Mongo suites skip)
npm run test:client -w @edh-seer/web                                          # component + integration tests
MONGO_TEST_URI=mongodb://localhost:27017 npm run test:server -w @edh-seer/web # + Mongo integration
```
