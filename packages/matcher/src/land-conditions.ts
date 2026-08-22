import { LAND_SUBTYPES } from "@mtg/tagger";
import type { Card } from "@mtg/engine";

/** WHAT A CONDITIONAL LAND DEMANDS, read off printed text. Free — no derivation, no clause layer,
 *  no spend, the `sagaEvents` shape (a printed cue the matcher reads directly).
 *
 *  WHY THIS IS NOT A BOOLEAN. `rules.json`'s `entersTapped` pattern is `enters(?: the battlefield)?
 *  tapped`, which matches *"enters tapped **unless** you control a Mountain or a Forest"* and reads
 *  a conditional land as unconditionally tapped. Measured on the owner's own deck: of 14 lands whose
 *  text says "tapped", **4 are unconditional and 10 are tapped only as the first land drop**. A flat
 *  term is wrong in both directions depending on the turn.
 *
 *  TWO CONSUMERS, ONE CLASSIFIER (roadmap I9 and I11). The EDGE side (I9) reads `subtypes` — "this
 *  land wants a Mountain, and your deck runs eleven" is a pairwise relation. The MANA side (I11)
 *  reads `entersTapped`. Neither may grow its own copy of these cues.
 *
 *  THE SUPERTYPE/SUBTYPE SPLIT IS LOAD-BEARING (owner's correction, 2026-08-22): *"it cares for the
 *  lands being basic, not having basic land type aka Mountain, Forest"*. `check` demands a basic
 *  land SUBTYPE, satisfied by Steam Vents and by Cinder Glade itself; `bfz` demands the SUPERTYPE
 *  `basic`, which a shockland does not carry and which **Cinder Glade does not satisfy for
 *  itself**. Measured: 233 nonbasic land slots across the 71 decks carry a basic land type, against
 *  1,016 basic land slots. */
export type LandTemplate =
  /** No tapped clause at all. */
  | "none"
  /** "This land enters tapped." with nothing after it. */
  | "unconditional"
  /** Check lands: "unless you control a Mountain or a Forest". Demands a basic land SUBTYPE. */
  | "check"
  /** Verge lands: "Activate only if you control a Mountain". An ACTIVATION restriction, never a
   *  tapped one — the land enters untapped and its second ability is switched off. */
  | "verge"
  /** Battle-for-Zendikar: "unless you control two or more basic lands". The SUPERTYPE, and a COUNT,
   *  so it names no member and is a deck-level fact rather than a pairwise one. */
  | "bfz"
  /** Slow lands: "unless you control two or more other lands". Untapped from the third drop. */
  | "slow"
  /** Fast lands: "unless you control two or fewer other lands". Untapped for the first three. */
  | "fast"
  /** Shocklands: "you may pay 2 life". A cost, not a condition — always untapped in this model. */
  | "shock"
  /** The Zendikar Rising pay-3-life cycle, including MDFC land backs. Same treatment as `shock`. */
  | "pay-life"
  /** "you may reveal a Plains or Island card from your hand". The condition is in HAND, which no
   *  board state can answer — classified so it is visible, and conservatively tapped. */
  | "reveal"
  /** "unless you have two or more opponents" — a FORMAT fact, not a board one. Never tapped in a
   *  real pod, and the only thing it needs is `opponents`, not a pod model. */
  | "pod"
  /** Text says tapped and no cue matched. Conservatively tapped, and COUNTED — a classifier with no
   *  unclassified row silently misreads. */
  | "unclassified";

export interface LandCondition {
  template: LandTemplate;
  /** Basic land subtypes the card names (`check`, `verge`, `reveal`). Empty otherwise. */
  subtypes: string[];
  /** The number the template compares against: `bfz` basics, `slow`/`fast` OTHER lands,
   *  `pod` opponents, `pay-life` life. Absent where the template names none. */
  count?: number;
  /** The land returns a land to hand when it enters (the Ravnica Karoos). Orthogonal to the tapped
   *  question and recorded because it breaks a LAND COUNT, which no tapped flag can express. */
  bounces: boolean;
}

/** The board as a conditional land reads it, at the moment it would enter.
 *
 *  `lands` counts the OTHER lands already on the battlefield — the land being played is not one of
 *  them, which is what "two or more other lands" says. */
export interface LandBoard {
  lands: number;
  basics: number;
  types: ReadonlySet<string>;
  opponents: number;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** Only a BASIC land subtype can appear in these conditions; anything else the regex catches is a
 *  misparse. Filtering against the rules' own list is what stops "a card" or "an opponent" becoming
 *  a subtype demand. */
const BASIC_SUBTYPES = new Set(["plains", "island", "swamp", "mountain", "forest"]);

const named = (...words: (string | undefined)[]): string[] =>
  words.filter((w): w is string => !!w && (BASIC_SUBTYPES.has(w) || LAND_SUBTYPES.has(w)));

/** The LAND face's text, for a card that has more than one.
 *
 *  A joined `oracleText` puts the front face's sentences in front of the land's, and the front face
 *  of an MDFC is a spell whose own text can carry every cue here -- Jwari Disruption's *"unless its
 *  controller pays {1}"*, and worse, any front face saying *"you may pay N life"*, which would
 *  classify the LAND as a shockland and hand it back untapped. That is the flattering direction, so
 *  it is the one to close. 57 corpus cards have more than one face.
 *
 *  Same split `land-count.ts:27-31` already uses; falls back to the whole text when the faces do not
 *  line up, because a wrong face is worse than an unsplit one. */
function landFaceText(typeLine: string, oracleText: string): string {
  if (!typeLine.includes("//")) return oracleText;
  const typeHalves = typeLine.split("//").map((h) => h.trim());
  const textHalves = oracleText.split(/\n\/\/\n/);
  if (typeHalves.length !== textHalves.length) return oracleText;
  const i = typeHalves.findIndex((h) => /\bland\b/i.test(h));
  return i >= 0 ? textHalves[i] : oracleText;
}

/** Classify one card's printed text. Non-lands return `none` — the caller decides whether to ask. */
export function classifyLand(card: Pick<Card, "typeLine" | "oracleText">): LandCondition {
  const text = landFaceText(card.typeLine ?? "", card.oracleText ?? "").toLowerCase();
  const bounces = /when this land enters, return a land you control to its owner's hand/.test(text);
  const base = { subtypes: [] as string[], bounces };

  // The verge cue is an ACTIVATION restriction and can sit on a land with no tapped clause at all,
  // so it is read before the tapped question rather than inside it.
  const verge = /activate only if you control (?:a|an) ([a-z'-]+)(?: or (?:(?:a|an) )?([a-z'-]+))?/.exec(text);
  const vergeTypes = verge ? named(verge[1], verge[2]) : [];

  // "put it onto the battlefield tapped" is about a FETCHED land, not this one -- Evolving Wilds
  // enters untapped and a bare /tapped/ test calls it a tapped land.
  if (!/enters(?: the battlefield)? tapped/.test(text)) {
    return vergeTypes.length > 0
      ? { ...base, template: "verge", subtypes: vergeTypes }
      : { ...base, template: "none" };
  }

  const life = /you may pay (\d+) life/.exec(text);
  if (life) {
    return { ...base, template: life[1] === "2" ? "shock" : "pay-life", count: Number(life[1]) };
  }
  if (/you may reveal (?:a|an) ([a-z'-]+)(?: or (?:(?:a|an) )?([a-z'-]+))? card from your hand/.test(text)) {
    const m = /you may reveal (?:a|an) ([a-z'-]+)(?: or (?:(?:a|an) )?([a-z'-]+))? card from your hand/.exec(text)!;
    return { ...base, template: "reveal", subtypes: named(m[1], m[2]) };
  }

  const unless = /unless you (?:control|have) ([a-z]+) or (more|fewer) (other lands|basic lands|opponents)/.exec(text);
  if (unless) {
    const count = NUMBER_WORDS[unless[1]];
    if (count !== undefined) {
      if (unless[3] === "opponents") return { ...base, template: "pod", count };
      if (unless[3] === "basic lands") return { ...base, template: "bfz", count };
      return { ...base, template: unless[2] === "fewer" ? "fast" : "slow", count };
    }
  }

  // "unless you control a basic land" is the `bfz` SUPERTYPE demand at a count of one, not a
  // subtype demand -- measured, 5 corpus lands (Agna Qel'a, Abandoned Air Temple, Realm of Koh,
  // Ba Sing Se, Fire Nation Palace). Read before the subtype cue, which would otherwise swallow
  // "basic" as a noun and find no subtype in it.
  if (/unless you control a basic land/.test(text)) return { ...base, template: "bfz", count: 1 };

  const check = /unless you control (?:a|an) ([a-z'-]+)(?: or (?:(?:a|an) )?([a-z'-]+))?/.exec(text);
  if (check) {
    const subtypes = named(check[1], check[2]);
    if (subtypes.length > 0) return { ...base, template: "check", subtypes };
    return { ...base, template: "unclassified" };
  }

  // THE AFR FRAME SAYS IT THE OTHER WAY ROUND -- "If you control two or more other lands, this land
  // enters tapped" (Hall of Storm Giants) -- which is `fast` with the count one lower: tapped at two
  // other lands means untapped at one or fewer.
  const inverted = /if you control ([a-z]+) or more other lands, this land enters(?: the battlefield)? tapped/.exec(text);
  if (inverted && NUMBER_WORDS[inverted[1]] !== undefined) {
    return { ...base, template: "fast", count: NUMBER_WORDS[inverted[1]] - 1 };
  }

  // THE GUARD THAT MAKES THE RESIDUAL BUCKET MEAN ANYTHING, and its absence was the module's own
  // founding rule broken from the inside. Reaching here with a live condition still in the text is
  // exactly the case `unclassified` exists for -- and without this test a bare "enters tapped"
  // match answered `unconditional` for every condition the cues above do not spell, so the cards
  // most in need of the bucket were the ones that never landed in it. Measured casualties, all
  // silently unconditional: the Duskmourn "13 or less life" cycle, the Eldraine "three or more
  // other Islands" cycle (Mystic Sanctuary), and the "opponents control eight or more lands" cycle.
  if (/\bunless\b/.test(text) || /\bif\b[^.]*enters(?: the battlefield)? tapped/.test(text)) {
    return { ...base, template: "unclassified" };
  }

  // "This land enters tapped." with nothing qualifying it. A bounce land lands here too, correctly:
  // it really is unconditionally tapped, and `bounces` carries the separate fact.
  return { ...base, template: "unconditional" };
}

/** Does this land enter tapped, given the board at the moment it is played?
 *
 *  THE DEFAULT IS TAPPED, for `unclassified` and for `reveal` — a land the classifier cannot read
 *  is charged the turn rather than given it, which is the direction that does not flatter the
 *  deck. */
export function entersTapped(cond: LandCondition, board: LandBoard): boolean {
  switch (cond.template) {
    case "none":
    case "verge":
    case "shock":
    case "pay-life":
      return false;
    case "pod":
      return board.opponents < (cond.count ?? 2);
    case "check":
      return !cond.subtypes.some((s) => board.types.has(s));
    case "bfz":
      return board.basics < (cond.count ?? 2);
    case "slow":
      return board.lands < (cond.count ?? 2);
    // "two or FEWER other lands" — untapped while you are at or below the count.
    case "fast":
      return board.lands > (cond.count ?? 2);
    case "reveal":
    case "unconditional":
    case "unclassified":
      return true;
  }
}
