# Loop detection from the synergy graph (#726) — research, not shipped

Can the repo's own graph find the infinite loops Commander Spellbook knows, without the index?
Measured on the 71 calibration decks (`packages/cli/decks/calibration`), against each deck's
Spellbook combos as ground truth. Conclusion (2026-09-29): **not yet**. Every variant either
misses most real loops or invents thousands. The tagger gaps behind that are filed as #801–#806.
What did ship is the other half: a known loop's payoff is its win condition
(`packages/matcher/src/combo-payoffs.ts`, PR #800).

## Rebuild the data (both files are gitignored, 16 MB and 1.2 MB)

    npx tsx research/combos/collect.ts   # -> decks.json: each deck's combos, reasons, cards (live static site)
    npx tsx research/combos/tags.ts      # -> tags.json: every card's abilities, compact; chars.json: printed characteristics

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

## The detector on tags (2026-09-30)

The tag fixes #801-#806, #846, #856-#860 gave `abil.py` what it used to regex out of printed text. Each
detector change is a switch, so its effect is measured alone:
`FIXES=none python3 research/combos/abil.py` is the regex detector, and the default is all of them.
`python3 research/combos/diff.py <fixes-a> <fixes-b>` lists the Spellbook combos one finds and the
other does not.

Cumulative, on the 71 calibration decks at DERIVE 214 (149 distinct Spellbook combos, 146 of them
infinite loops):

| switch added | what it does | recall | precision (loops) | loops in the 44 combo-free decks |
|---|---|---|---|---|
| none | the regex detector (no text workarounds: the tags carry #801/#803) | 22/156 | 1% (35,792) | 367 |
| `cost` | costs from `payment` (#806): mana, {T}, life, a sacrifice outlet as fodder only when it eats one body | 22 | 3% (9,385) | 113 |
| `reduce` | reducers from `reduces` (#804): generic mana only (CR 118.7a), where their subject reaches, stacked | 22 | 2% (9,496) | 69 |
| `bounce` | the `bounce` kind (#802): repeatable, aimed by its subject; a self-bounce recasts itself (Acererak) | 27 | 9% (2,320) | 253 |
| `return` | a recast is paid only when the cycle casts the card; mana is a budget off the cycle, not a step; a one-card cycle (Acererak) is a loop when a payer that leaves it alive covers it | 32 | 15% (1,010) | 221 |
| `land` | lands are played and tokens never cast: no recast | 32 | 15% (1,007) | 220 |
| `subject` | flicker, untap and recursion reach only what their subject names; recursion to hand needs a recast; a return that marks what it returns (finality / flying counter, tag `oncePerObject`) is once per creature | 32 | 29% (384) | 43 |
| `cast` | a card re-entered is not re-cast, a copy is not cast unless the copier casts it, "if you cast it" does not fire on a flicker | 32 | 40% (280) | 40 |
| `copyloop` | a copier that re-enters and copies from its entry (Dualcaster Mage + a flicker spell) loops without a return | 37 | 41% (292) | 40 |
| `top` | Sensei's Divining Top puts itself on top and a `play-from-top` permission casts it again | 44/156 | 41% (298) | 40 |

Still not modelled: a self-damage loop kept alive by a second card (Boros Reckoner; Stuffy Doll + Pariah,
whose redirect is not read as a replacement), The Chain Veil's re-activation (`extra-loyalty`),
Stridehangar Automaton's surplus token, Mikaeus's undying board, and the everything-is-a-land deck's
37 Princess Yue variants.

**DERIVE 215 (#886, #887): the last two text workarounds are gone.** A return that marks what it
returns is `oncePerObject` on the ability, and a flicker's "return that card" takes its subject from the
exile (Displacer Kitten: nonland permanent you control). `abil.py` reads both off the tags. Re-measured
on a scratch static build (`STATIC=http://localhost:<port> npx tsx research/combos/collect.ts`, then
`tags.ts`, both honour `STATIC`): **recall 44/156, precision 123/298 (41%), 40 loops in combo-free decks**
-- identical to the text reads. The 71 decks' 72,631 reasons did not move (0 lost, 0 won): the
edges already read the emits, which resolved the pronoun.

`probe.ts <card names>` prints a card's stored clauses and a fresh derive -- the first thing to run on a
detector miss.
