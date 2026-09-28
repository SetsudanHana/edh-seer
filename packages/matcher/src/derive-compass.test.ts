import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { loadHierarchy, pairReasons } from "./index.js";
import { classifyPair, type CompassPair } from "./eval-pairs-core.js";
import { fixtureDeckCard, fixtureNames } from "./fixture-cards.js";

const GOLD = JSON.parse(
  readFileSync(new URL("./compass-pairs.json", import.meta.url), "utf8"),
) as CompassPair[];
const byName = { has: (n: string) => fixtureNames.has(n) };
const deckCard = fixtureDeckCard;

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
  // --- blink-etb (9) and reanimator (1) USED to sit here. Resolved 2026-09-28 by owner ruling, not
  // by widening the engine: the 4 flicker + flicker pairs left the gold set (two flickers share a
  // theme, not an interaction; one is banked in compass-anti-pairs.json), and the 5 Soulherder pairs
  // and Animate Dead / Gray Merchant are keyed on the tag of the reason that IS the synergy
  // (`exiled:creature`, `enters:creature`) -- their category demanded a flicker or recursion effect
  // kind the rulings refuse (a bare-creature recursion does not narrow).

  // --- mill-self (3) USED to sit here: Syr Konrad's second and third trigger limbs ("or a creature
  // card is put into a graveyard from anywhere other than the battlefield", "or a creature card
  // leaves your graveyard") did not fit a ClauseRecord's single trigger event. Banked 2026-09-28
  // (DERIVE 188): derive reads each extra "or" limb from the clause text as a twin trigger.

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
