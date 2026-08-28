# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Commander (EDH) deckbuilders, tuning a specific deck. They paste a decklist (plus commander name(s)) repeatedly while iterating — reading the synergy/archetype/combo/mana-math output to decide what to cut and add.

Roadmap audience (not yet built): the same players once the tool grows into a full Commander toolkit — building decks, tracking their physical/digital collection, and getting nudged when a deck needs cards they don't own.

## Product Purpose

Today: paste a decklist + commander(s), get an oracle-text-derived synergy report — mana curve, land math, archetype groupings, card-by-card synergy roles, and combo detection — to inform deckbuilding decisions.

Long-term (confirmed direction, not yet implemented): grow into a full Commander deckbuilding platform — build and save decks, track a card collection across paper and digital, surface card suggestions, and flag when a deck needs cards the user doesn't own (with a nudge toward tearing down another paper deck or proxying via MTGPrint).

## Positioning

Two-part, both confirmed by the user:

1. **Explains synergy, doesn't just rank popularity.** A rule-based oracle-text engine tags mechanisms (produces/cares chains) and requires a stated reason for every synergy edge — it says *why* two cards work together, unlike EDHREC-style "X% of decks run this" popularity stats.
2. **Analysis is one layer of a bigger toolkit, not a standalone EDHREC competitor.** It's the first phase of an eventual all-in-one Commander tool (build + collection tracking + paper/digital awareness); positioning should read as foundational, not as a finished rival product.

## Operating Context

Flow: user pastes a decklist and commander name(s) into a text form → server resolves cards (`@edh-seer/data`), tags oracle text (`@edh-seer/tagger`), matches synergy via a rule-based matcher (`@edh-seer/matcher`), computes deck-level analysis (`@edh-seer/engine`) → client renders a tabbed report (Overview / Archetypes / Cards / Combos) with mana curve, land math, deck identity/cohesion, and missing-card flags.

No accounts, no saved decks, no persistence yet — each analysis is a one-shot paste-and-read session.

## Capabilities and Constraints

- Current shipped scope: synergy analysis only. Deck building, collection tracking, and paper/digital tracking are confirmed roadmap, not yet built — do not imply they exist in UI copy.
- Monorepo (`npm` workspaces): `packages/data` (card corpus + resolution), `packages/tagger` (oracle-text mechanism tagging), `packages/matcher` (rule-based synergy matching), `packages/engine` (deck-level analysis), `packages/cli`, and this app, `packages/web` (NestJS + Fastify server, React 19 + Vite client, HeroUI3 + framer-motion).
- Card corpus: ~20k cards tagged from oracle text (tagging grind complete).
- Key terms used in-app and in data: commander, synergy edge, archetype, produces/cares (a card "produces" an effect another "cares about"), cohesion.

## Evidence on Hand

- Working synergy/matcher/engine pipeline with an existing tabbed report UI (Overview/Archetypes/Cards/Combos tabs; DeckIdentity, ArchetypeBoard, CardList, ComboList, ManaCurveChart, LandMathChart components already exist in `client/src/components`).
- No user testimonials, pricing, licensing, or deployment claims exist — do not fabricate any for this surface.

## Brand Commitments

**Visual craft bar (confirmed 2026-07-31):** the UI is a conventional dark analytics dashboard, executed at full craft — the category standard, taken deliberately rather than a novel visual world. Craft bar: **Scryfall** and **Archidekt/Moxfield**, the actual category peers — polish and execution should read as belonging next to them, not as a generic SaaS template or an illustrated/skeuomorphic MTG-card pastiche. This was chosen after two rolled alternates (a seed-catalog world, a tournament-standings-board world) were reviewed and set aside in favor of the plain standard, on purpose.

## Product Principles

1. Every synergy claim needs a stated reason (produces/cares mechanism chain) — never surface a bare "these go well together" without why.
2. Data-driven from oracle text, not curated/vibes-based — the engine's credibility rests on this.
3. Optimize for the iterative-tuning loop: fast re-paste, fast re-read, easy to spot what changed between iterations.
4. Build the analysis layer so it can host the bigger toolkit later (decks, collection, paper/digital) without a rewrite — but don't build those features early.
5. Collection/paper-vs-digital reality-awareness is a long-term product commitment; keep language and structure open to it even before it exists.
