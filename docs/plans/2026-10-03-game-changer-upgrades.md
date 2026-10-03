# Game Changer upgrades: brackets as power within a group (2026-10-03)

Part of #976 (redundancy groups). The owner, 2026-10-03: "deployment went in but b2-4 still does not
change on the card suggestion between the precons".

## What the owner decided

- **Brackets are power within a group** (2026-10-02): B2 takes the best member of a group that is
  not a Game Changer, B3 also allows up to 3 Game Changers, B4 takes the best member regardless.
- **A new swap kind with its own measure** (2026-10-03). A Game Changer upgrade is not strictly
  better, so it is not a role swap, and H4 is not loosened to let it through.

## Why B2, B3 and B4 come out the same

On the run 6 pages, 148 of 194 precons have the same non-bring-down swaps at B2 and B4. A package
differs between targets only through bring-down cuts and the guard's Game Changer cap. A role swap
must be strictly better on every measure, and no Game Changer passes: most are strong through a
condition `sameJob` refuses (Mana Vault does not untap, Mox Diamond discards a land, Smothering Tithe
works "unless that player pays"). In a prototype over 20 precons, no Game Changer passed `sameJob`
for any deck card, and role quality (`q`) cannot rank them either: Sol Ring reads 99, Mana Vault 98.

## The rule

A **Game Changer upgrade** swaps a deck card for a Game Changer when:

1. the cut is one a role section may cut: the report's trim cards whose only protection is a role,
   not an engine hub (`roleSwapCuts`), not a creature, not a commander;
2. the Game Changer fills every build role the cut fills;
3. it is in the same group in each of them (`sameGroup`): the same kind of ramp, an answer that hits
   every card type the cut hits with no limit the cut lacks, or every effect the cut's role ability
   has. Shape, printed conditions and amount are not compared;
4. its role quality is higher than the cut's in each of those roles;
5. it is not a creature;
6. it works at least as often as the cut (the `frequency` measure): a card that works once never
   replaces one that works every turn. Added after one single-precon build (Multiverse Reforged
   offered Lion's Eye Diamond and Jeska's Will for Signets), before the full build. The measures
   below are unchanged.
7. for ramp, it does not sacrifice a land when the cut does not: Crop Rotation trades a land for a
   land. Added after the first full build, whose R1 read found it offered for Cultivate and Harrow
   (90 packages); the build was run again with it. The measures are unchanged.

Being a Game Changer is the power signal: the official list names the strongest cards at their jobs.
The options for a cut list its Game Changer upgrades first, strongest first, then its strict role
swaps. The gatherer and its bracket guard are unchanged, so B2 refuses every Game Changer and falls
through to the strict option, B3 takes Game Changers until the deck holds 3, and B4 takes them all.

The prototype found Game Changer upgrades in all 20 sampled precons. Read by hand before the
trim-card limit, about half were wrong, all by cutting a theme card (Skullclamp, Kindred Discovery,
Awakening Zone → The One Ring or Mana Vault) or by offering Lion's Eye Diamond as plain ramp. The
trim-card limit is rule 1 for that reason. These measures were written after the prototype and
before the first build of the rule.

## Pre-registered measures

On all precons, built from one data version, against main built from the same data:

Hard, 100%, the instrument exits 1:

- **H1-H5 unchanged.** H4 reads `role` swaps only, as it always did.
- **G1.** Every `game-changer` swap's add is a Game Changer, fills every build role the cut fills,
  and the cut is not a commander or a creature. Recomputed by the instrument from the cards.
- **G2.** No `game-changer` swap in a target-2 package.

Soft, recorded, and a miss blocks shipping until the owner rules:

- **B1.** Of the precons with both a B2 and a B4 package, at least 60% have a B4 package whose swaps
  differ from B2's.
- **R1.** A hand read of 10 `game-changer` swaps, every Nth across the build: at least 8 a player
  would make at that bracket. Each verdict is recorded with its reason in RESULTS.
- **S1 and S2 unchanged.**
