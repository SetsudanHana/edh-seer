# @edh-seer/data

Ingestion + storage for the MTG synergy engine. Downloads Scryfall Oracle Cards
and Commander Spellbook combos into MongoDB, and resolves decklists into engine
`Card`/`Combo` objects.

## Setup

```bash
docker compose -f packages/data/docker-compose.yml up -d   # start MongoDB
npm run ingest -w @edh-seer/data                                # download + store
```

Environment:
- `MONGO_URI` (default `mongodb://localhost:27017`)
- `MONGO_DB` (default `mtg`)

## Run a real deck through the engine

```bash
npm start -w @edh-seer/cli -- packages/cli/decks/golden.txt         # plain text
npm start -w @edh-seer/cli -- https://www.moxfield.com/decks/<id>   # Moxfield URL
```

## Tests

```bash
npm test -w @edh-seer/data                                          # pure unit tests
MONGO_TEST_URI=mongodb://localhost:27017 npm test -w @edh-seer/data # + Mongo integration
```
