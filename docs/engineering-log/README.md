# Engineering log

A dated record of what this engine learned, measured, and got wrong.

Every entry was written the day the work landed, and each one carries the numbers as they read at
the time: the population before and after, the panel precision, what a change cost in dollars, and
which of the day's hypotheses did not survive contact with a measurement. Several entries exist
mainly to record a refusal — a feature built, swept against a pre-registered criterion, and deleted
because the criterion failed.

These files were one 535 KB block inside the project's `CLAUDE.md` until 2026-08-30, when they were
split out verbatim. The split was verified byte-for-byte; nothing was rewritten, curated, or
tidied on the way out. That means the entries contradict each other in places — a later day
correcting an earlier one is the point of keeping both.

## How to read it

**Newest first.** An older entry describes what was believed then, not what is true now; where two
entries disagree, the later one governs. A claim about the code is a claim about the code *on that
date*, so verify before acting on one — a 2026-08-26 audit of the project's own roadmap found 44%
of its open lines had gone stale, and that rate is the reason this warning is here.

| date | what it is about |
|---|---|
| [2026-08-29](2026-08-29.md) | The persist gate's refusal list was mostly *our* defects, 165 → 34 — and one missing word showed up as three refusal families at once. Prompt caching had never fired in the project's whole life and was 97.6% of every corpus bill. Buying the corpus by EDHREC rank: 16,949 cards for $33.42, with the calibrated gates byte-identical afterwards. Going public, the history rewrite, CodeQL to zero. |
| [2026-08-28](2026-08-28.md) | Fallout from faces-as-nodes: a face that does not print the token does not make it, and a card-wide static relates to a permanent once (CR 712.3a). An enter-as-a-copy replacement is a reason to be blinked. A proliferate had a supply and no demand. |
| [2026-08-27](2026-08-27.md) | Every printed face of a multi-face card becomes its own graph node. Nine tasks, the measured population move, and the eleven separate join sites found to be matching a face name against data keyed on the physical card. |
| [2026-08-26](2026-08-26.md) | The mana model, end to end: coloured-source sequencing, a clock that has to pay for its own board, tap-replacements, phase triggers and event triggers — most of them one cue and three refusals. Plus the stale-line audit that found 44% of open roadmap lines wrong. |
| [2026-08-25](2026-08-25.md) | The goldfish simulator ships and its own falsifier fires, so the point readout is withdrawn for an interval. Two adversarial reviews of the mana model and the fourteen defects they filed. Legality as a report and never a gate. Commander brackets. |
| [2026-08-23](2026-08-23.md) | The REAL-column census. Precision becomes an owner-denominated figure again, and it is lower: 92.9%, judging debt 0. |
| [2026-08-22](2026-08-22.md) | The Batch API at half price — 1,408 cards for $3.24 — and why batching the transport is not the thing that once broke this pipeline. A trigger-doubler cannot say which triggers it doubles: 14 of 15 derive no subject at all. |
| [2026-08-16](2026-08-16.md) | The longest entry. Tokens become first-class nodes and start mediating. Edge magnitude built, swept and refused three separate times against the same criterion. Per-role scores. The cut list. Cost reduction becomes a pairwise claim again, on the owner's ruling. |
| [2026-08-15](2026-08-15.md) | Sagas die and nothing had ever seen it. Land-finder edges. The resource ledger. CR 614 multipliers are consumers of an event, never sources of it. A vocabulary run that paid for itself by naming its own next gap. |
| [2026-08-06](2026-08-06.md) | `TAGS_SOURCE` flips to `derived` on a blind measurement — 70.7% against 18.0%. The frozen panel is built. The first judge-agreement draws, and why precision was withdrawn as an engine figure. |

## What the numbers mean

- **edges / reasons** — the size of the claim population over the 71 calibration decks. A *reason*
  is one sentence about why two cards relate; an *edge* is a pair carrying at least one.
- **panel** — precision over 895 frozen, hand-judged card pairs. It is paired, so a change that
  moves it moved something; it is also blind outside those pairs, which is why the population
  figures are always quoted beside it.
- **MESHED** — how many claims fan out past a cap. It is the guard against a rule that matches
  everything, and "MESHED unchanged" is frequently the whole acceptance test.
- **free / MONEY** — whether a change requires re-asking a language model about the card corpus.
  Derivation and matching are deterministic and free to re-run; normalization is not.

For how the engine itself works, start with [HOW-IT-WORKS.md](../HOW-IT-WORKS.md).
