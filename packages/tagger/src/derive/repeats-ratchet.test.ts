import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { Ability } from "../schema.js";
import { DERIVE_VERSION } from "./derive.js";
import { repeatsFor } from "./repeats.js";

/** Abilities the rules cannot name, as a FIXED list captured from the corpus. Both directions are
 *  load-bearing, exactly as `KNOWN_DEFECT_CAP` and `derive-compass` are:
 *
 *   - the count may not GROW, so a new gap cannot be waved through;
 *   - a quarantined ability that starts resolving FAILS, so an improvement has to be banked here
 *     rather than silently absorbed.
 *
 *  A ratchet nobody has tested is decoration. Both arms were verified by hand on 2026-08-11, then
 *  reverted; see the task-3 report for the full transcript:
 *   1. `REFUSED_CAP` dropped to 594 -> "the refused set has not grown" FAILED:
 *      "AssertionError: expected 595 to be less than or equal to 594".
 *   2. A throwaway rule added to `repeats.ts`'s trigger branch ("if (verbs.includes("gain-life"))
 *      return "once";") resolved 8 fixture rows -> "a refused ability that now resolves must be
 *      banked, not silently absorbed" FAILED, naming them: Wall of Limbs, Exemplar of Light, Vito
 *      Thorn of the Dusk Rose, Marauding Blight-Priest, Starscape Cleric, Heliod Sun-Crowned, and
 *      Ratchet Field Medic // Ratchet Rescue Racer (twice, one per face).
 *
 *  THE TWO ARMS ARE NOT EQUIVALENT (2026-08-11 review, finding 2; rewritten 2026-11-17, #722). Arm 2
 *  ("a refused ability that now resolves...") is LIVE on every run -- it calls `repeatsFor` fresh against
 *  the checked-in fixture, so any rule change that newly resolves one of its rows fails immediately. Arm 1
 *  ("the refused set has not grown") bounds the CHECKED-IN FIXTURE'S row count only. The fixture is
 *  stamped with the DERIVE_VERSION it was generated at, the freshness test fails when it is stale, and
 *  `derive:bump` regenerates it, so arm 1 follows the live refusal count as of the last bump:
 *
 *    npx tsx research/tagger/repeats-report.ts --refused packages/tagger/src/derive/repeats-refused.json
 *
 *  THE REMAINING GAP: `repeats` is computed at DERIVE time (`repeatsFor` is called from `derive.ts`), so a
 *  change to `repeats.ts` is a derive semantics change. CLAUDE.md says to bump DERIVE_VERSION for those,
 *  which stales the stamp and forces the regeneration. Skip the bump and the stamp stays "fresh" over a
 *  fixture the new rules would not produce: arm 2 still catches newly resolving rows, but a rule that
 *  makes MORE abilities refuse is not seen until the next bump. Also note: every row in this fixture
 *  carries `cost: ""` structurally -- rules 1-2 (`repeats.ts`) run against `cost` BEFORE the trigger
 *  branch, so any ability with a real, non-empty cost resolves via rule 1 or 2 and can never reach
 *  refusal. The ratchet reads `cost` correctly; this fixture simply cannot exercise that arm. */
const FIXTURE = new URL("repeats-refused.json", import.meta.url);

/** Raise ONLY with a written reason. Lower it whenever a rule is added (arm 1 is `toBe`: a smaller fixture fails too).
 *
 *  Dropped 595 -> 579 (task 4, 2026-08-11): `ORDINAL_EACH_TURN` in `repeats.ts` resolved 16 refused
 *  abilities, including Faerie Mastermind's own trigger -- the card the taxonomy was built around
 *  was itself in the refused set until this rule existed. Verified: population 27380/35037/231 and
 *  panel 82.8% both held after the fix, because nothing reads `repeats` yet.
 *
 *  Raised 579 -> 621 (finding 3, 2026-08-11 review): `attacks` was pulled out of `PHASE_VERBS` and
 *  is now phase-shaped only when `subject.self === true` (`repeats.ts`). The 202 `attacks:you`
 *  abilities that were wrongly resolving to `per-cycle` for a CLASS subject ("whenever a creature
 *  you control attacks") mostly re-resolve to `repeatable` via rule 9, but some carry no type/
 *  subtype at all and correctly fall all the way through to refusal -- that is the source of the
 *  +42 rows. This is a CORRECTNESS fix, not a new gap: a confidently wrong label is worse than an
 *  honest refusal. Verified after re-deriving: population 27380/35037/231 and panel 82.8% both held,
 *  because nothing reads `repeats` yet. */
/** Re-banked 621 -> 1413 (2026-09-05, owner: "fix the repeats labeller so Black Market Connections
 *  counts as engine"). TWO THINGS MOVED AT ONCE and the number only makes sense read as both:
 *  the fixture had never been regenerated since it was captured on the 2,541-card calibration
 *  corpus, and the corpus is 21,317 cards now, so the row count was never comparable to the live
 *  refusal count (3,118 refused of 37,912 abilities, 8.2%, on the morning of the change). Then the
 *  rules widened -- `RawTrigger` lets a step outside the `Verb` union (main-phase, draw-step) and a
 *  saga chapter resolve, rule 9 reads an untyped non-self trigger as a class, rule 8b reads the
 *  card's own or an untyped combat trigger as once per combat, and `sacrifice`/`enters-graveyard`/
 *  `cast` joined SELF_EVENTS -- and refusal fell to 1,413 (3.7%). 454 of the old 621 rows resolve.
 *  Verified: population 35655/45598/289 and panel 429 / 387 / 16 both held, because a label still
 *  changes what nothing matches; the draw facet moved 400 -> 445 engines, 107 -> 41 unlabelled. */
/** 1413 -> 1438 (2026-09-05, same day, later): `emits.ts` gives `exile` its own destination when
 *  the model states none (Swords to Plowshares' exile was UNCLAIMED and emitted nothing), and a
 *  `return` the clause text sends "to its owner's hand" the same (Otawara). 582 such actions
 *  became abilities (37,912 -> 38,494) and 25 of them -- exiles and bounces on triggers the rules
 *  cannot name -- refuse honestly. Refusal share unchanged at 3.7%. */
/** Re-banked 1438 -> 2812 (2026-11-17, #722, owner ruling "regenerate + keep fresh"). The fixture was a bare array
 *  last captured 2026-09-05; it is now `{ deriveVersion, rows }`, regenerated on DERIVE 537: 2,812 refused rows, 4.4% of
 *  abilities. Diffed by (name, clauseText): 707 old keys are gone and 2,052 new keys appear (as a multiset 711 gone,
 *  2,085 new; duplicate keys are why neither adds up to 2,812). 699 of the 707 were `kind: "triggered"` with no
 *  `trigger` object; derive now recognises the trigger and the ability resolves (Hornet Nest and Flumph now carry
 *  `trigger.verbs: ["damaged"]`, `repeats: "repeatable"`), which arm 2 could not see on the old shape. By card, loosely
 *  matched on `effect.kind`: about 440 of the 467 cards behind the gone rows resolve, 21-39 lost the ability
 *  (depending on how mixed cards count), 11 still refuse under new clause text. Of the 2,052 new keys 2,015 are on
 *  cards with no row in the old fixture (1,435 grammar-sourced, 520 model-sourced): derived rows went 21,317 -> 32,804.
 *  2,679 of the 2,812 rows are triggered abilities with no `trigger` object; that is what the fixture mostly pins.
 *  The cap tracks a FRESH fixture: `derive:bump` regenerates it and the version test fails when it is stale. Arm 1 is
 *  two-sided (`toBe`): a regeneration that SHRINKS the set must be banked here too. Arm 2 is kept as it was. */
/** 2812 -> 2850 (2026-11-18, #1673, DERIVE 539). Regenerated on a corpus that now holds the Star Trek cards (Scryfall
 *  re-ingest; 93 -> 87 cards in derive scope with no row after this change, on a clean database): 38 rows added,
 *  0 gone, every one of the 38 on a card with no row in the 2,812-row fixture, i.e. newly derived cards whose
 *  triggers the rules cannot name. */
/** 2850 -> 2853 (2026-11-18, #1678, DERIVE 540): three rows added on newly derived cards whose triggers the rules
 *  cannot name -- Sash and Waistcoat (evasion), Rikala (its 'tap an Island for mana' mana line) and Sylvia Tilly
 *  (the reflexive counter). 0 gone. */
/** 2853 -> 2854 (2026-11-19, #1675, DERIVE 542): one row added, T'Pring, Never Parted's draw, whose trigger
 *  ("a creature that fought this way dies this turn") the rules cannot name. 0 gone. */
/** 2854 -> 2858 (2026-11-19, #1672, DERIVE 543): four rows added on newly derived cards whose triggers the rules
 *  cannot name -- Zekes, Acid Rock Fan's draw and discard ("if it was cast for its emerge cost") and Yume, Chronicler
 *  of Valor's two draws. 0 gone. */
/** 2858 -> 2859 (2026-11-20, #1679, DERIVE 551): one row added, The Madcap Jester's play of opponent-owned cards
 *  from exile, whose trigger ("a spell or ability you control causes one or more cards to be exiled from an
 *  opponent's library") derive refuses as a narrowing, so the rules cannot name it. 0 gone. */
/** 2857 -> 2854 (2026-11-21, #1720, DERIVE 572): three rows gone, the textless empty `exiled` twins of God-Eternal Bontu, God-Eternal Kefnet and Ilharg, the Raze-Boar, which the fold now removes beside the covering "dies or is put into exile" clause. 0 added. */
const REFUSED_CAP = 2854;

/** `repeatsFor` takes THREE arguments -- `cost` feeds rules 1-2 (self-sacrifice, {T}/{Q}),
 *  `clauseText` feeds rule 3 ("once each turn"). A fixture row missing `cost` would half-disable the
 *  second arm: a refusal later resolved by a cost rule would never be detected. */
type Row = { name: string; clauseText: string; cost: string; ability: Ability };

/** The fixture is `{ deriveVersion, rows }`: the DERIVE_VERSION it was generated at, then the refused abilities. */
const load = () => JSON.parse(readFileSync(FIXTURE, "utf8")) as { deriveVersion: number; rows: Row[] };

// Without this the fixture went 1,438 -> 2,812 rows unnoticed (#722): arm 1 bounds only the checked-in row count and arm 2 feeds
// `repeatsFor` the abilities as they were shaped when the file was captured. Mongo-free, so it runs in CI.
test("the refused fixture was generated at the current derive version (regenerate: npx tsx research/tagger/repeats-report.ts --refused packages/tagger/src/derive/repeats-refused.json, or npm run derive:bump)", () => {
  expect(load().deriveVersion).toBe(DERIVE_VERSION);
});

test("the refused set is exactly the banked size (grows and shrinks both fail)", () => {
  const { rows } = load();
  expect(rows.length).toBe(REFUSED_CAP);
});

test("a refused ability that now resolves must be banked, not silently absorbed", () => {
  const { rows } = load();
  const resolved = rows.filter((r) => repeatsFor(r.ability, r.clauseText, r.cost) !== undefined);
  expect(
    resolved.map((r) => r.name),
    "these now resolve -- remove them from repeats-refused.json and lower REFUSED_CAP",
  ).toEqual([]);
});
