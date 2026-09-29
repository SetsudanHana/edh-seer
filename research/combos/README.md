# Loop detection from the synergy graph (#726) — research, not shipped

Can the repo's own graph find the infinite loops Commander Spellbook knows, without the index?
Measured on the 71 calibration decks (`packages/cli/decks/calibration`), against each deck's
Spellbook combos as ground truth. Conclusion (2026-09-29): **not yet**. Every variant either
misses most real loops or invents thousands. The tagger gaps behind that are filed as #801–#806.
What did ship is the other half: a known loop's payoff is its win condition
(`packages/matcher/src/combo-payoffs.ts`, PR #800).

## Rebuild the data (both files are gitignored, 16 MB and 1.2 MB)

    npx tsx research/combos/collect.ts   # -> decks.json: each deck's combos, reasons, cards (live static site)
    npx tsx research/combos/tags.ts      # -> tags.json: every card's abilities, compact

Both read `https://edhseer.cards/static`, so they measure the DEPLOYED engine. Re-run them after a
tagger or matcher deploy before comparing numbers.

## The layers, in the order they were tried

| script | what it adds | read |
|---|---|---|
| `loops.py` | card-level SCCs over the synergy graph, plus mana / untap / stack / flicker / bounce edges read off printed text, and one-shot edges promoted when the piece can recur | recall only: is there a cycle among a known combo's pieces |
| `strict.py` | the owner's rules (2026-09-05): every step repeatable, each loop's mana cost paid by its own production | `RECALL`, `PRECISION`, loops found in combo-free decks |
| `abil.py` | the same at ABILITY level: a cycle leaves a card through the ability it entered by, delayed triggers never close a loop, spells resolve once, life costs need life gain | same three numbers; `python3 research/combos/abil.py [kmax]` |
| `missing.py`, `recall.py`, `precision.py` | which edges each missed Spellbook combo lacks, and which false loops recur | feeds `missing-per-combo.json`, `strict-miss.json` |
| `payoffs.py`, `payoff-probe.ts`, `payoff-all.ts` | the payoff half: who eats what a known loop repeats | became `combo-payoffs.ts` |

Run everything from the repo root (`python3 research/combos/strict.py`).
