# Calibration corpus — 71 real Commander decks

Exported 2026-08-04 from the maintainer's Moxfield account (`/v3/decks/all/<publicId>`, which
needs no per-deck `exportId`, unlike the `/export` endpoint). Moxfield is behind Cloudflare, so a
server-side fetch gets 403 — these came out through a logged-in browser session.

`deck-names.json` maps each file to its Moxfield deck name. **Those names are the labels**: the
maintainer named them for what they do ("Abzan - Defenders", "Rakdos Landfall", "Bello -
Enchantress", "Acererak Combo", "Voltron mill"), so they are ground truth for whether a zone or
theme the engine picks is the one a player would name.

## Why 71 and not 7

The zone-selection rules for the deck board were first fitted on 7 decks and **overfit**. On 7
decks a corpus-IDF floor of 2.2 cleanly separated real themes from junk. On 71 it does not:
`static:pump` (idf 2.37) and `static:cost-reduction` clear that floor and then claim 90 of 92 and
97 of 98 cards. Two guards only became visible at this corpus size — a zone must claim between 5
cards and ~55% of the deck, and a second zone must not be the first one respelled
(`create-token:treasure` and `enters:treasure` are one mechanism).

Any future tuning of theme ranking, zone selection or membership should be measured against all
71, not a handful.

## Known gaps this corpus exposes

- **Superfriends is unrepresentable.** `loyalty` appears in none of the 1040 corpus theme tags and
  planeswalkers are tagged on 10 of 20,410 cards, so "Ups, all Chandras" can only ever read as
  burn.
- **Tribal decks** ("Tribal Tribal", "Dra(w/ke) tribal") get no tribal zone; kindred was
  deliberately excluded from `MECHANISM_CATEGORIES`. Subtype zones like `enters:wizard` do work.
- One deck of the 71 (`Fairdrazi - 5 color(less)`) was private at export time and was re-fetched
  after it was unlisted; nothing else is missing.
