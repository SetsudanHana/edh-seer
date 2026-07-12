# @mtg/data

Ingestion + storage for the MTG synergy engine. Downloads Scryfall Oracle Cards
and Commander Spellbook combos into MongoDB, and resolves decklists into engine
`Card`/`Combo` objects.

## Setup

```bash
docker compose -f packages/data/docker-compose.yml up -d   # start MongoDB
npm run ingest -w @mtg/data                                # download + store
```

Environment:
- `MONGO_URI` (default `mongodb://localhost:27017`)
- `MONGO_DB` (default `mtg`)

## Run a real deck through the engine

```bash
npm start -w @mtg/cli -- packages/cli/decks/golden.txt         # plain text
npm start -w @mtg/cli -- https://www.moxfield.com/decks/<id>   # Moxfield URL
```

## Tests

```bash
npm test -w @mtg/data                                          # pure unit tests
MONGO_TEST_URI=mongodb://localhost:27017 npm test -w @mtg/data # + Mongo integration
```
