/** ONE LAND, READ IN ONE DECK (#767, task 3): the facts a land swap is judged on. Nothing else in
 *  the matcher scores a single land; `mana-base.ts` scores them all at once, and a land swap must
 *  pass that too (H5).
 *
 *  THREE FACTS, EACH ONE A PLAYER CAN CHECK ON THE CARD: the colours it makes that this deck's
 *  spells ask for, whether it enters tapped, and whether it does anything besides make mana. A land
 *  is strictly better than another (owner, 2026-09-30) when it makes every needed colour the other
 *  makes, enters tapped no more often, does everything else the other does, and gains on colours or
 *  on tapped. */
import type { Card } from "@edh-seer/engine";
import { fetchableLands, fetchDemand, fetchedLandEntersTapped, isLandFetch } from "./fetch-land.js";
import { classifyLand } from "./land-conditions.js";
import { COLORS, pipsByColor, type Color } from "./mana-audit.js";
import { rolesOfCard } from "./quality.js";
import type { DeckCard } from "./types.js";

/** The same test `mana-base.ts` uses, so a land here is a land there. */
const isLand = (dc: DeckCard): boolean => /\bland\b/i.test(dc.card.typeLine);

/** 0 never, 1 some turns (a check, slow, fast or battle land), 2 every time. */
export type Tapped = 0 | 1 | 2;

export interface LandFacts {
  name: string;
  /** The colours it makes (or fetches) that the deck's spells ask for. */
  colours: Color[];
  tapped: Tapped;
  /** What it does besides make mana, as ability effect kinds (a creature land's `animate`,
   *  Bojuka Bog's `graveyard-hate`). Empty for a plain land. */
  utility: string[];
  /** It costs damage or life to tap for mana. */
  hurts: boolean;
  basic: boolean;
  /** The front face is a land: a card played as a land, not a spell that transforms into one. */
  front: boolean;
}

/** EFFECTS THAT ARE NOT A LAND'S JOB: making mana, fetching a land, and a karoo's bounce, which is
 *  a cost. */
const NOT_UTILITY = new Set(["", "mana-generation", "search", "bounce"]);
const PLUMBING = new Set(["sacrifice", "dies", "search", "shuffle", "leaves"]);
/** A LAND'S ORDINARY BUSINESS, line by line: making mana (at a cost in life or damage, or only on a
 *  condition), entering tapped, a tapped land's consolation, a karoo's bounce, a fetch. */
const PLAIN: readonly RegExp[] = [
  /^\{t\}(?:, pay \d+ life)?: add [^.]*\.(?: (?:~|it) deals \d+ damage to you\.)?(?: activate only [^.]*\.)?(?: spend this mana only [^.]*\.)?$/,
  /\benters(?: the battlefield)? tapped\b/, /^as ~ enters, you may pay \d+ life\./,
  /^when ~ enters, (?:you gain 1 life|scry 1|return a land you control to its owner['’]s hand)\.$/,
  /\bsearch your library for\b/,
];
const MANA_LINE = /^\{t\}(?:, pay \d+ life)?: add ([^.]*)\./;
/** THE COLOURS IT MAKES FOR A TAP ALONE. A filter land's second colour needs coloured mana in (Mystic
 *  Gate), and Tainted Wood's needs a Swamp ("activate only"), so neither counts: only a plain "{T}:
 *  Add" line with nothing after it but a painland's damage does. */
/** WHAT THE LINE ADDS, WITH NOTHING ATTACHED: symbols joined by "or", or one mana of any colour
 *  (your commander's included). "{W} for each enchantment you control" can add nothing. */
// A SEPARATOR BETWEEN EVERY GROUP, never optional: with it optional the groups could split one run of
// symbols many ways, which backtracks exponentially on a long one (CodeQL, 2026-09-30).
const PLAIN_YIELD = /^(?:\{[wubrgc]\})+(?:(?:,? or |, )(?:\{[wubrgc]\})+)*$|^one mana of any colou?r(?: in your commander['’]s colou?r identity)?$/;
const BASIC_TYPES: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };
function tapColours(dc: DeckCard): string[] {
  const out = new Set<string>();
  // A BASIC LAND TYPE IS A MANA ABILITY (CR 305.6), printed only as reminder text, which is not read.
  const subtypes = ((dc.card.typeLine ?? "").split("//")[0]!.split(/—/)[1] ?? "").toLowerCase();
  for (const [t, c] of Object.entries(BASIC_TYPES)) if (new RegExp(`\\b${t}\\b`).test(subtypes)) out.add(c);
  for (const line of printedLines(dc)) {
    const m = MANA_LINE.exec(line);
    if (!m || /\bactivate only\b/.test(line) || !PLAIN_YIELD.test(m[1]!.trim())) continue;
    if (/\bany colou?r\b/.test(m[1]!)) for (const c of COLORS) out.add(c);
    for (const sym of m[1]!.matchAll(/\{([wubrg])\}/g)) out.add(sym[1]!.toUpperCase());
  }
  return [...out];
}

/** The printed lines that are not a land's ordinary business, joined: what else it does or asks. */
export function unusualText(dc: DeckCard): string {
  return printedLines(dc).filter((l) => !PLAIN.some((re) => re.test(l))).join("\n");
}
function printedLines(dc: DeckCard): string[] {
  const name = dc.card.name.toLowerCase();
  return (dc.card.oracleText ?? "").replace(/\([^)]*\)/g, "").toLowerCase().split(name).join("~")
    .replace(/\bthis land\b/g, "~").split("\n").map((l) => l.trim()).filter(Boolean);
}
/** A TAPPED LAND'S CONSOLATION: the life or the scry a land hands you FOR entering tapped is what
 *  makes up for it, so it is not something the untapped land it makes way for has to match.
 *  Otherwise Scoured Barrens could never give way to Godless Shrine. Only on a land that always
 *  enters tapped; anywhere else it is an ability like any other. */
const CONSOLATION = new Set(["lifegain", "scry"]);

/** The colours the deck's spells ask for, commanders included: every coloured pip in a nonland
 *  card's mana cost. */
export function neededColours(deck: readonly DeckCard[]): Set<Color> {
  const out = new Set<Color>();
  for (const dc of deck) {
    if (isLand(dc)) continue;
    const pips = pipsByColor(dc.card.manaCost);
    for (const c of COLORS) if ((pips[c] ?? 0) > 0) out.add(c);
  }
  return out;
}

export function landFacts(dc: DeckCard, needed: ReadonlySet<Color>, library: readonly Card[]): LandFacts {
  const text = dc.card.oracleText ?? "";
  const fetches = isLandFetch(text);
  // AS `colourSources` COUNTS IT: a land that makes mana makes its own colours; only a land that makes
  // none (a fetch) takes the colours of what it fetches. Flagstones of Trokair makes {W}, whatever it
  // finds when it dies.
  const own = dc.card.producedMana ?? [];
  const produced = own.length > 0 || !fetches ? tapColours(dc) : fetchableLands(text, library).flatMap((c) => c.producedMana ?? []);
  const colours = COLORS.filter((c) => needed.has(c) && produced.includes(c));
  const template = classifyLand(dc.card).template;
  // A FETCH THAT MAKES NO MANA ITSELF TAKES ITS LAND'S TIMING, as `tappedLandCount` reads it.
  const tapped: Tapped = (dc.card.producedMana ?? []).length === 0 && fetches
    ? (fetchedLandEntersTapped(text, 3) ? 2 : 0)
    : template === "unconditional" || template === "unclassified" || template === "reveal" ? 2
      : template === "check" || template === "bfz" || template === "slow" || template === "fast" ? 1
        : 0;
  const abilities = dc.tags?.abilities ?? [];
  // WHAT IT DOES BESIDES MAKE MANA. An ability derive gave no effect kind still counts when it does
  // something (Rogue's Passage, Reliquary Tower's static), unless all it does is a fetch's or a
  // karoo's plumbing: sacrifice, die, search, shuffle, leave.
  const kinds: string[] = [];
  for (const a of abilities) {
    if (a.effect.kind === "mana-generation") continue;
    const verbs = (a.emits ?? []).map((e) => e.verb).filter((v) => !PLUMBING.has(v));
    kinds.push(a.effect.kind || verbs.join("+") || (a.kind === "static" && (a.emits ?? []).length === 0 ? "static" : ""));
  }
  // A KEYWORD ON A LAND IS SOMETHING IT DOES (hideaway, cycling, channel), and derive does not always
  // write it as an ability: Windbrisk Heights' hideaway has none (2026-09-30). And a build role is a
  // job: Myriad Landscape is ramp (it fetches two lands), not a colourless land.
  kinds.push(...(dc.card.keywords ?? []).map((k) => k.toLowerCase()), ...(dc.tags?.characteristics ? rolesOfCard(dc) : []));
  // AND WHAT DERIVE DID NOT WRITE AT ALL: Reliquary Tower's "no maximum hand size" and Rogue's
  // Passage's unblockable have no ability in their tags (2026-09-30), so any printed line that is not
  // a land's ordinary business is something it does.
  if (printedLines(dc).some((l) => !PLAIN.some((re) => re.test(l)))) kinds.push("printed");
  // MANA ON A CONDITION CANNOT BE WEIGHED: Exotic Orchard's colours are the opponents' lands', Tainted
  // Field's need a Swamp. Read as colourless, either would be "upgraded" to a one-colour land.
  if (printedLines(dc).some((l) => { const m = MANA_LINE.exec(l); return m && (/\bactivate only\b/.test(l) || !PLAIN_YIELD.test(m[1]!.trim())); })) kinds.push("conditional-mana");
  const utility = [...new Set(kinds)].filter((k) => !NOT_UTILITY.has(k) && !(tapped === 2 && CONSOLATION.has(k))
    && k !== "damage" && k !== "lose-life" && k !== "non-combat-damage").sort();
  // WHAT IT COSTS YOU TO USE: a painland's damage, a horizon land's life. Paid every time, unlike a
  // shock's one payment to enter untapped, which the mana base model already reads as untapped.
  // ONLY ON THE MANA ABILITY'S OWN COST: Castle Locthwain's life loss comes with its card draw, not
  // with its mana. Derive splits a painland's damage into its own ability with the mana ability's cost.
  const manaCosts = new Set(abilities.filter((a) => a.effect.kind === "mana-generation").map((a) => a.cost ?? ""));
  const hurts = abilities.some((a) => manaCosts.has(a.cost ?? "") && ((a.cost ?? "").toLowerCase().includes("life")
    || (a.emits ?? []).some((e) => (e.verb === "non-combat-damage" || e.verb === "lose-life") && e.subject.control === "you")));
  return {
    name: dc.card.name, colours, tapped, hurts, utility,
    basic: /\bbasic\b/i.test(dc.card.typeLine ?? ""),
    front: /\bland\b/i.test((dc.card.typeLine ?? "").split("//")[0]!),
  };
}

export interface LandGain { ok: boolean; untapped: boolean; colours: Color[] }

/** Y IN FOR X: X does nothing but make mana, Y makes every needed colour X makes, enters tapped no
 *  more often, costs no life or damage X does not, and gains on colours or on tapped. */
export function betterLand(x: LandFacts, y: LandFacts): LandGain {
  const no: LandGain = { ok: false, untapped: false, colours: [] };
  if (!x.colours.every((c) => y.colours.includes(c))) return no;
  if (y.tapped > x.tapped) return no;
  // A LAND THAT DOES SOMETHING ELSE IS NEVER CUT: no measure here says another land's ability is
  // worth as much as this one's.
  if (x.utility.length > 0) return no;
  if (y.hurts && !x.hurts) return no;
  const colours = y.colours.filter((c) => !x.colours.includes(c));
  const untapped = y.tapped < x.tapped;
  return { ok: untapped || colours.length > 0, untapped, colours };
}

/** THE BASICS THE DECK'S OWN CARDS GO LOOKING FOR: every card that searches out a basic land (a
 *  Myriad Landscape, a Cultivate) counts what it asks for. A land swap never cuts a basic below
 *  this, so no card in the deck is left fetching nothing. */
export function basicsFloor(deck: readonly DeckCard[]): number {
  const library = deck.map((dc) => dc.card);
  let floor = 0;
  for (const dc of deck) {
    const text = dc.card.oracleText ?? "";
    if (!/\bbasic land\b/i.test(text)) continue;
    const d = fetchDemand(text, library);
    if (d) floor += d.wants;
  }
  return floor;
}
