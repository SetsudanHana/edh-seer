import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { deriveCardTags } from "@mtg/tagger";
import type { Characteristics } from "@mtg/tagger";
import type { ClauseRecord } from "@mtg/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { classifyPair, type GoldPair } from "./bin/eval-pairs-core.js";
import type { DeckCard } from "./types.js";

interface Fixture {
  name: string;
  oracleId: string;
  clauses: ClauseRecord[];
  characteristics: Characteristics;
  /** Clause id -> text, so the offline gate derives what production derives. See ClauseFixture. */
  clauseTexts?: Record<number, string>;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/gold-clauses.json", import.meta.url), "utf8"),
) as Fixture[];
const GOLD = JSON.parse(
  readFileSync(new URL("./goldpairs.json", import.meta.url), "utf8"),
) as GoldPair[];

const byName = new Map(FIXTURE.map((f) => [f.name, f]));

function deckCard(name: string): DeckCard {
  const f = byName.get(name);
  if (!f) throw new Error(`fixture missing card: ${name} — regenerate with build-gold-fixture.ts`);
  return {
    card: {
      name: f.name,
      typeLine: [...f.characteristics.types, ...f.characteristics.subtypes].join(" "),
      oracleText: "",
      keywords: f.characteristics.keywords,
      colors: f.characteristics.colors,
      manaValue: f.characteristics.cmc,
      colorIdentity: f.characteristics.identity,
      power: f.characteristics.power,
      toughness: f.characteristics.toughness,
    },
    tags: deriveCardTags({
      oracleId: f.oracleId, clauses: f.clauses, characteristics: f.characteristics,
      clauseTexts: f.clauseTexts,
    }),
  };
}

test("the fixture covers every card the verified gold pairs reference", () => {
  const needed = [...new Set(GOLD.filter((p) => p.verified).flatMap((p) => [p.a, p.b]))];
  const missing = needed.filter((n) => !byName.has(n));
  expect(missing).toEqual([]);
});

/** Gold pairs the derivation layer cannot pass, keyed `${a} / ${b}` with the reason it cannot.
 *
 *  The LIVE-DB pipeline scores 55/55 on this same gold set. 14 of those 55 pass only because the
 *  old tagger recorded something the card does not say — read the reasons below and note how few of
 *  them are about derivation at all. This list is therefore NOT a lowered bar: it is a quarantine
 *  of known defects in the BASELINE, and the test below fails in both directions, so it cannot rot.
 *  Removing an entry is the only way to bank an improvement, and an entry that starts passing
 *  breaks the build until someone removes it. */
const KNOWN_BASELINE_DEFECTS: Record<string, string> = {
  // --- blink-etb (9): the flicker ability is timed "at the beginning of your end step". The live
  // tag records it as trigger ["enters"], and all 9 edges are drawn off that. `blink-etb` accepts
  // only effectKind flicker/clone, and effectKind comes from the CONSUMER's ability, so a pair can
  // only pass if a flicker ability consumes an event — which a phase trigger never does. This is
  // the exact bug the end-step/upkeep/begin-combat verbs were added to VERB_VOCAB to fix.
  "Ephemerate / Soulherder": "Soulherder's flicker is an end-step trigger; live tags it as `enters`",
  "Ephemerate / Teleportation Circle": "Teleportation Circle's flicker is an end-step trigger; live tags it as `enters`",
  "Soulherder / Cloudshift": "Soulherder's flicker is an end-step trigger; live tags it as `enters`",
  "Soulherder / Ghostly Flicker": "Soulherder's flicker is an end-step trigger; live tags it as `enters`",
  "Soulherder / Teleportation Circle": "both flickers are end-step triggers; live tags both as `enters`",
  "Soulherder / Eerie Interlude": "Soulherder's flicker is an end-step trigger; live tags it as `enters`",
  "Cloudshift / Teleportation Circle": "Teleportation Circle's flicker is an end-step trigger; live tags it as `enters`",
  "Ghostly Flicker / Teleportation Circle": "Teleportation Circle's flicker is an end-step trigger; live tags it as `enters`",
  "Teleportation Circle / Eerie Interlude": "Teleportation Circle's flicker is an end-step trigger; live tags it as `enters`",

  // --- mill-self (2): Syr Konrad triggers on three separate limbs; the mill payoff rides the
  // second ("a creature card is put into a graveyard from anywhere other than the battlefield").
  // ClauseRecord.trigger holds a single `event` string, so limbs 2 and 3 are not expressible at the
  // clause layer at all. Synthesizing them from the `dies` limb would be false — a milled creature
  // card does not die — and would mesh every death trigger with every mill card.
  "Ruin Crab / Syr Konrad, the Grim": "Syr Konrad's `enters-graveyard` trigger limb; ClauseRecord.trigger holds one event",
  "Maddening Cacophony / Syr Konrad, the Grim": "Syr Konrad's `enters-graveyard` trigger limb; ClauseRecord.trigger holds one event",
  // The third of the same family, and it only LOOKED different. It passed until `castSelfSupplied`
  // on a reason that was never the synergy: Syr Konrad, being a castable card, satisfied Consuming
  // Aberration's unconstrained "whenever you cast a spell" — which every nonland card in every deck
  // does. The real link is Aberration's opponent-mill feeding Konrad, and that rides the same
  // inexpressible second limb as the two above, so it was never available. A pair passing through a
  // claim that applies to any ordinary card was banking luck, not a synergy.
  "Consuming Aberration / Syr Konrad, the Grim": "Syr Konrad's `enters-graveyard` trigger limb; was passing on an ordinary-card cast claim until castSelfSupplied",

  // --- toughness-matters (1) and counters-plus1 (2): the clause is `verb: "other"`, which
  // normalize-prompt.ts defines as the escape hatch for actions no verb covers and calls "honestly
  // inert". Reaching these categories means regexing that free text — the flat-engine patterns.ts
  // approach this layer replaces — and, for Doran, additionally inventing a toughness>=power
  // StatPredicate the card never states.
  "Doran, the Siege Tower / Wall of Omens": "Doran's damage rule is `verb: \"other\"`, inert by the normalizer's contract",
  // The two Tekuthal pairs USED to sit here, quarantined on "Tekuthal's proliferate-doubling is
  // `verb: "other"`, inert by the normalizer's contract". Banked 2026-08-15 by `replacement.ts`:
  // the doubling is read off the clause TEXT rather than waiting for a verb, and Tekuthal now
  // consumes the `proliferate` event both pairs supply. The ratchet caught it, which is the whole
  // reason a passing quarantined pair is a FAILURE here.

  // --- reanimator (1): this one passed on a reason that contradicts the card, and stopped when the
  // reason got MORE correct. Animate Dead's ETB trigger used to normalize with subject "this",
  // which parsed to no type at all -- `enters:any` -- so the pair matched via "Animate Dead
  // triggers on Gray Merchant entering". It does not; it triggers on the Aura's own entry. The
  // fixture regeneration under NORMALIZE_VERSION 2 records "this Aura", and subtype parsing now
  // resolves that to `subtype: aura`, so the false event edge is gone. The SYNERGY is real -- you
  // reanimate the Gray Merchant -- but it is a targeting relationship (a graveyard-recursion effect
  // and a creature card in a graveyard), not an event one, and `pairReasons` has no rule for it.
  // Deleting this entry needs that rule, not a looser trigger subject.
  "Animate Dead / Gray Merchant of Asphodel": "passed via a false `enters:any` edge; Animate Dead triggers on its OWN entry",
};

test("derived tags pass every gold pair except the documented baseline defects", () => {
  const hierarchy = loadHierarchy();
  const regressions: string[] = [];
  const stale: string[] = [];
  const keys = new Set<string>();
  for (const pair of GOLD) {
    if (!pair.verified) continue;
    const key = `${pair.a} / ${pair.b}`;
    keys.add(key);
    const a = deckCard(pair.a), b = deckCard(pair.b);
    const outcome = classifyPair(pair, pairReasons(a, b, hierarchy), a, b);
    const quarantined = key in KNOWN_BASELINE_DEFECTS;
    if (outcome.status === "PASS") {
      if (quarantined) {
        stale.push(`${key} now PASSES — delete its KNOWN_BASELINE_DEFECTS entry to bank the win`);
      }
    } else if (!quarantined) {
      const cause = outcome.noEdgeCause ? `/${outcome.noEdgeCause}` : "";
      regressions.push(`[${pair.category}] ${key}: ${outcome.status}${cause}`);
    }
  }
  // A quarantine entry naming a pair that no longer exists is silently quarantining nothing.
  const orphans = Object.keys(KNOWN_BASELINE_DEFECTS).filter((k) => !keys.has(k));

  expect(regressions, "derivation lost a synergy the pipeline used to find").toEqual([]);
  expect(stale, "KNOWN_BASELINE_DEFECTS is stale").toEqual([]);
  expect(orphans, "KNOWN_BASELINE_DEFECTS names a gold pair that does not exist").toEqual([]);
});
