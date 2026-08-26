import type { DeckCard } from "./types.js";
import { COLORS, isManaSource, type Color } from "./mana-audit.js";
import { classifyLand, entersTapped, type LandCondition } from "./land-conditions.js";
import { DEFAULT_POD_SIZE, opponents } from "./format.js";

/** THE MANA AVAILABILITY MODEL — a seeded goldfish simulation with a WRITTEN PLAY POLICY, because
 *  the policy IS the model (roadmap I11, `specs/2026-08-22-mana-availability-model-design.md`).
 *
 *  WHY A SIMULATOR AND NOT A COEFFICIENT. A fitted coefficient against these 71 decks is the thing
 *  that died three times in this repo (the supply:demand discount, twice more under re-registration);
 *  a stated policy is auditable, and every number below can be argued with by reading rule 1-5.
 *
 *  WHAT IT REPLACES, since L4a (2026-08-25): `castability.ts`'s two hypergeometric axes. That module
 *  reported a mana axis and a colour axis and refused to multiply them — correctly, since both are
 *  driven by the same lands — and the cost of the refusal was that NO figure in the report meant
 *  "you can cast this card". This model asks the board both questions in the same trial.
 *
 *  **IT STILL FEEDS NO SCORE**, which is the condition the K7/J7 reconciliation holds under:
 *  `deck-math.ts` reads it for the castability PANEL and `pressure.ts` does not read it at all, so
 *  no rating, `buildScore` or archetype moves when a number here does.
 *
 *  THE DEFECT IT EXISTS FOR, measured on the owner's own deck: `castability.ts` ships an INTERVAL
 *  whose contract is "the truth is between them", and on `samut.txt` at turn 6 that pair reads
 *  [34.1%, 43.5%] against a simulated 55.8% — because `manaWithRocks` counts three sources for a
 *  green land-ramp deck. Farseek, Nature's Lore, Three Visits, Cultivate, Kodama's Reach and Shared
 *  Roots are all invisible to it: a land-fetch spell produces no mana of its own and `isManaSource`
 *  correctly refuses an instant or sorcery.
 *
 *  AND A SECOND DEFECT THE CLOSED FORM CANNOT FIX: `pAtLeast` NEVER CAPS LAND DROPS.
 *  `pAtLeast(4, 37, seen(3), 99)` answers 55.5% — four mana on turn three, off three land drops.
 *  Sound only where `turn === manaValue`, which is the only place it is called today, and unusable
 *  for the off-diagonal curve this module produces.
 *
 *  CEILINGS, and the first one governs every other number here:
 *  - **NO EXTERNAL GROUND TRUTH EXISTS.** Nothing in this repo can tell a simulated 55.8% from a
 *    true 58%. The closed-form anchors bound the MECHANICAL error; the POLICY error is bounded only
 *    by the sensitivity arm.
 *  - **THE DRAW BIAS SURVIVES**: rule 5 casts no cantrips, so `seen(T) = 7 + T` is as wrong here as
 *    in the closed form.
 *  - **COLOURS ARE MODELLED SINCE L4a**, which is why `byCardCastable` may carry that word and the
 *    mana rows may not: `manaAt` and `payableShareAt` are still P(six mana) and say nothing about
 *    whether three of those six can be the right colours.
 *  - **ONE-SHOT MANA IS DROPPED, AND NOT OBVIOUSLY CONSERVATIVELY**: Big Score's Treasures PERSIST,
 *    and rituals really do enable a turn.
 *  - **A SOURCE IS WORTH WHAT IT TAPS FOR, since `manaOutput` (2026-08-25) — Sol Ring two, Thran
 *    Dynamo three, assembled tron seven. What is STILL flat: a source whose output depends on a
 *    board this model does not track. Enduring Vitality scales with creatures, Cabal Coffers with
 *    Swamps, and a filter or karoo land is priced at its NET one on purpose.
 *  - **NO OPPONENT.** Nothing is Stax'd, countered or killed.
 *
 *  **THE WHOLE-ITEM FALSIFIER FIRED, AND THIS IS THE RECORDED OUTCOME (2026-08-25).** The design
 *  registered it before any number existed: *"if the anchors pass but C8 shows policy noise on the
 *  order of the ramp signal, the verdict is that mana availability is a POLICY property at this
 *  deck's scale, the point readout is WITHDRAWN, and what survives is the interval."*
 *
 *  **THE ANCHORS PASS AND C8 TRIGGERS. Measured over the 71 decks at 20k trials: holding up two mana
 *  before casting an accelerant moves the headline cell by up to 27.6pp, against a MEDIAN RAMP
 *  SIGNAL of 32.7pp** — 84% of the effect this module exists to measure, where the demotion rule
 *  fires at 50%. So `goldfish-report.ts` prints a PAIR of policies and never one number, and any
 *  future report wiring inherits that: **the greedy arm is a CEILING, the hold-up-2 arm is nearer how
 *  a real deck is played, and the truth is between them.** The same resolution `castability.ts`
 *  already reached, for the same reason, and it is a recordable outcome rather than a failure —
 *  which is what separates this from the clock it sits beside. */

/** Mulberry32. A named, seeded generator so every figure is reproducible — `Math.random` is banned
 *  by test, because a Monte Carlo whose output moves between runs cannot be a ratchet baseline. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AccelerantKind =
  /** A noncreature permanent that taps for mana. NO SUMMONING SICKNESS (CR 302.6 restricts
   *  creatures), so it pays the turn it lands — delaying Sol Ring a full turn in every trial is a
   *  silent wrong answer, and the first draft of this policy did exactly that. */
  | "rock"
  /** A creature that taps for mana. Genuinely waits a turn. */
  | "dork"
  /** A spell that puts a LAND onto the battlefield. It does not consume the land drop, and the land
   *  it fetches follows its own tapped state — Nature's Lore fetches untapped, Kodama's Reach
   *  fetches tapped, and the spell's own text is what says which. */
  | "land-fetch";

export interface Accelerant {
  name: string;
  manaValue: number;
  kind: AccelerantKind;
  /** `land-fetch` only: the fetched land arrives tapped. */
  fetchTapped?: boolean;
}

/** A spell that puts a land onto the battlefield — the same two cues `rules.json`'s
 *  `ramp.landFetchSpell` already pairs, kept here rather than routed through the rule engine because
 *  this module needs the TAPPED half too and a rule row carries no payload. */
const LAND_FETCH = /search your library for (?:a |an |up to \w+ )?(?:basic )?(?:land|forest|island|swamp|mountain|plains)/i;
const ONTO_BATTLEFIELD = /onto the battlefield/i;
const SUSPEND = /\bsuspend \d/i;
/** A FETCH IS NOT FREE JUST BECAUSE THIS MODEL PERFORMS IT (roadmap N12). Myriad Landscape's two
 *  basics cost `{2}`, Urza's Cave `{3}`, and **Wayfarer's Bauble is cast for {1} and then cracked for
 *  {2} a turn later** — none of which the model pays, so each was a free land the moment it appeared.
 *  The activation cost is what sits before the colon on the fetch's own line; `{T}` and a sacrifice
 *  and a life payment are all costs this model CAN pay, and a mana symbol is not.
 *
 *  A LAND THAT FAILS THIS IS STILL A LAND — Myriad Landscape taps for `{C}` and enters tapped — it
 *  simply neither fixes colours nor thins until someone pays. That is the under-claiming direction,
 *  and it is 63 land slots plus 25 spell slots across the 71 decks. */
const MANA_IN_COST = /\{(?!t\}|q\})[^}]+\}/i;
function fetchCostsMana(text: string): boolean {
  const line = text.split("\n").find((l) => LAND_FETCH.test(l)) ?? "";
  return line.includes(":") && MANA_IN_COST.test(line.slice(0, line.indexOf(":")));
}
/** The fetched land's own tapped state, printed on the fetch: "put it onto the battlefield TAPPED".
 *  Fabled Passage — 21 slots, and the only card of the family that prints the clause — then untaps it
 *  once you control four lands, which is the `slow` shape one board count over. */
const FETCH_UNTAPS = /untap that land/i;
const FETCHES_TAPPED = /onto the battlefield tapped/i;

/** DOES THIS CARD MAKE MANA, or does Scryfall merely think so? `producedMana` is stamped from QUOTED
 *  TOKEN TEXT as well as the card's own abilities, so **Pitiless Plunderer** — which taps for nothing
 *  and makes Treasures — arrived carrying five colours and was priced as a four-mana dork adding one
 *  every turn from the turn after it lands (roadmap N9). Treasure mana is a ONE-SHOT resource, and
 *  `isManaSource` already refuses one-shots on exactly that ground: the same rule, one layer over.
 *
 *  TWO WAYS TO REALLY MAKE MANA, and both are printed. The card says "add" in its OWN text, or it
 *  GRANTS a mana ability to permanents you control — Enduring Vitality's *"Creatures you control have
 *  '{T}: Add one mana of any color'"* is a genuine engine and is one of the three accelerants the old
 *  hypergeometric model could see at all. **A grant whose quoted ability SACRIFICES the permanent is
 *  the one-shot again wearing a grant's sentence** (Goldspan Dragon grants to Treasures), so it is
 *  refused with the rest. */
function makesItsOwnMana(text: string): boolean {
  // Quotes hold OTHER objects' abilities -- a token's, an enchanted permanent's -- so the card's own
  // claim is what is left when they are stripped.
  if (/\badds?\b/i.test(text.replace(/"[^"]*"/g, " "))) return true;
  for (const m of text.matchAll(/\b(?:has|have) "([^"]*)"/gi)) {
    if (/\badds?\b/i.test(m[1]) && !/sacrifice this/i.test(m[1])) return true;
  }
  return false;
}

/** What kind of accelerant a card is, or null. Read from PRINTED data only — `producedMana` and the
 *  type line — because a play policy that depends on derivation would move whenever derivation did. */
export function classifyAccelerant(dc: DeckCard): Accelerant | null {
  const line = (dc.card.typeLine ?? "").toLowerCase();
  const name = dc.card.name;
  const manaValue = dc.card.manaValue ?? 0;
  // A land is a land drop, never an accelerant cast -- and this reads the JOINED type line ON PURPOSE
  // where `simulate` reads the FRONT face (N3): a transform card's `producedMana` carries its BACK
  // face's mana, so a front-face read here would price Ojer Axonil as a recurring red source, which
  // it is not until it dies and transforms.
  if (/\bland\b/.test(line)) return null;
  const text = dc.card.oracleText ?? "";
  if (LAND_FETCH.test(text) && ONTO_BATTLEFIELD.test(text) && !fetchCostsMana(text)) {
    return { name, manaValue, kind: "land-fetch", fetchTapped: FETCHES_TAPPED.test(text) };
  }
  // A ONE-SHOT IS NOT A SOURCE at any confidence — `isManaSource`'s own ruling, and the measured
  // reason it exists (139 of 3,197 `producedMana` library cards are rituals). Dark Ritual really
  // does enable a turn, which is a stated ceiling and not an oversight.
  // A SUSPENDED CARD IS NEVER CAST FROM HAND FOR ITS PRINTED COST (CR 702.62), and rule 3 casts by
  // mana value alone -- so Sol Talisman and Mox Tantalite, both mana value 0, were deployed FREE on
  // turn one and taps for two from turn two. The real sequence is a cost plus a three-turn wait.
  // The same shape `castability.ts` REFUSES rather than prices (roadmap N9).
  if (SUSPEND.test(text) && (dc.card.manaValue ?? 0) === 0) return null;
  if (!isManaSource(dc) || (dc.card.producedMana ?? []).length === 0 || !makesItsOwnMana(text)) return null;
  return { name, manaValue, kind: /\bcreature\b/.test(line) ? "dork" : "rock" };
}

/** How much mana ONE activation nets, and the board condition it is gated on. Every source in this
 *  model produced exactly ONE mana until this existed — a Forest, Sol Ring and an assembled Urza's
 *  Tower alike — so the whole ramp curve was priced off the COUNT of sources rather than their
 *  output. Sol Ring alone sits in 52 of the 71 decks.
 *
 *  READ FROM PRINTED TEXT, like `classifyAccelerant` beside it, so the play policy never moves when
 *  derivation does. */
export interface ManaOutput {
  /** The unconditional amount. 1 for an ordinary source. */
  amount: number;
  /** `Temple of the False God`: "Activate only if you control five or more lands". */
  needsLands?: number;
  /** The tron shape: two named other lands on the board upgrade the amount.
   *
   *  DRAWING THE TRIO IS NOT HOW TRON ASSEMBLES, and the first cut of this branch missed it and
   *  measured zero. Three NAMED singletons among the 13 cards a turn-6 trial has seen is
   *  (13x12x11)/(99x98x97) = 0.18% — but PLANAR NEXUS is "every nonbasic land type", so one card is
   *  an Urza's Mine AND an Urza's Power-Plant at once, and it sits in 6 of the 7 tron decks.
   *  `everyLandType` is what makes the branch reachable. Prismatic Omen is deliberately NOT it:
   *  every BASIC land type does not include Urza's. */
  tron?: { subtypes: [string, string]; amount: number };
}

/** MANA IN A COST STRING. `{2}` is two, `{U}` is one, `{T}` is none — because "{1}, {T}: Add {U}{B}"
 *  is ONE mana and reading the Add run alone prices it at two. The first count over this corpus made
 *  exactly that mistake and reported 27 lands where the answer is 9. */
const TAP_ONLY = /^\{t\}:\s*add\s/i;
const ADD_RUN = /add ((?:\{[^}]+\}\s*)+)/i;
/** THE SAME AMOUNT IN WORDS, which the symbol reader cannot see: "Add three mana of any one color"
 *  (roadmap N10). **Sceptre of Eternal Glory is in 11 decks and was priced at one.** `X` is
 *  deliberately absent -- it is a RATE and not an amount, the ruling I4 already made one subsystem
 *  over -- so a card that adds X keeps the incumbent 1 rather than a guess. */
const ADD_WORDS = /add (one|two|three|four|five|six|seven|eight|nine|ten) mana\b/i;
const SYMBOLS = /\{[^}]+\}/g;
/** Mana this model cannot spend correctly. It is COLOUR-BLIND (C10), so a restriction it cannot
 *  check must not be counted at face value — Jegantha taps for five that pay no generic cost. */
const RESTRICTED = /spend this mana only|can't be spent|this mana can't/i;
/** A karoo returns a land as it enters, so tapping for two off one fewer land is NET NEUTRAL and
 *  the incumbent 1 is already right. Counting it 2 without modelling the bounce over-claims. */
const BOUNCES = /return a land you control to its owner's hand/i;
const LAND_GATE = /activate only if you control (\w+) or more lands/i;
/** "If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C}{C} instead." Matched on the
 *  SUBTYPE as printed inside the sentence, which is what the board carries — and the subtype is
 *  `Urza's Power-Plant` with a hyphen while the CARD is `Urza's Power Plant` without one. */
const TRON = /if you control (?:an?|the) ([^,]+?) and (?:an?|the) ([^,]+?), add ((?:\{[^}]+\})+) instead/i;
/** A land that IS every land type, so it answers any subtype check on the board by itself — Planar
 *  Nexus, and Omo's everything counter one layer out of reach. BASIC-ONLY IS REFUSED: Prismatic
 *  Omen's "every basic land type" does not include Urza's, which is the whole point of the check. */
const EVERY_LAND_TYPE = /\bis every (?:nonbasic )?land type\b/i;
export function isEveryLandType(typeLine: string | undefined, oracleText: string | undefined): boolean {
  return /\bland\b/i.test(typeLine ?? "") && EVERY_LAND_TYPE.test(oracleText ?? "");
}

const WORD_NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function manaOutput(oracleText: string | undefined): ManaOutput {
  const text = oracleText ?? "";
  if (BOUNCES.test(text)) return { amount: 1 };
  let out: ManaOutput = { amount: 1 };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // The cost must be EXACTLY {T}. A sacrifice, a counter removal or a loyalty cost is not a tap
    // this model can pay, and a mana cost is what makes a filter land a one-mana land.
    if (!TAP_ONLY.test(line) || RESTRICTED.test(line)) continue;
    const run = ADD_RUN.exec(line);
    const words = ADD_WORDS.exec(line);
    if (!run && !words) continue;
    const amount = run
      ? (run[1].match(SYMBOLS) ?? []).length
      : WORD_NUMBER[words![1].toLowerCase()];
    const gate = LAND_GATE.exec(line);
    const tron = TRON.exec(line);
    const here: ManaOutput = {
      amount,
      ...(gate && WORD_NUMBER[gate[1].toLowerCase()] ? { needsLands: WORD_NUMBER[gate[1].toLowerCase()] } : {}),
      ...(tron ? { tron: { subtypes: [tron[1].trim(), tron[2].trim()], amount: (tron[3].match(SYMBOLS) ?? []).length } } : {}),
    };
    // A gated line only wins if it beats what the card already makes unconditionally.
    const bestOf = (o: ManaOutput): number => Math.max(o.amount, o.tron?.amount ?? 0);
    if (bestOf(here) > bestOf(out)) out = here;
  }
  return out;
}

/** What a source taps for right now. */
function produced(o: ManaOutput, lands: readonly OnBoardLand[]): number {
  if (o.tron) {
    const has = (s: string): boolean =>
      lands.some((l) => l.everyLandType || l.typeLine.toLowerCase().includes(s.toLowerCase()));
    if (o.tron.subtypes.every(has)) return o.tron.amount;
  }
  // ZERO, not one. "Activate only if you control five or more lands" means Temple of the False God
  // taps for NOTHING below the gate — the incumbent priced it at one, which is a land that does not
  // exist for the first four turns of every game.
  if (o.needsLands !== undefined && lands.length < o.needsLands) return 0;
  return o.amount;
}

/** COLOURS AS A BITMASK over `COLORS`. Colourless is the EMPTY mask, not a sixth bit: `{C}` pays
 *  generic and no coloured pip, which is exactly what an empty mask does under `payable` below. */
/** THE SIXTH BIT. Colourless is a MANA TYPE, not the absence of one (CR 106.1b), and `{C}` is payable
 *  only with colourless mana (CR 107.4c) — so carrying it as the empty mask was right for a SOURCE,
 *  where colourless constrains nothing about what it can pay, and exactly backwards for a COST, where
 *  it constrains everything. A board of Forests read as able to cast Kozilek (roadmap N11).
 *
 *  It sits above the five colours rather than inside `COLORS`, because `mana-audit.ts`'s WUBRG list
 *  is about COLOURED SOURCES against Karsten's table and a sixth entry there would change what that
 *  table counts. */
const COLORLESS = 1 << COLORS.length;

export function colorMask(producedMana: readonly string[] | undefined): number {
  let m = 0;
  for (const c of producedMana ?? []) {
    const u = c.toUpperCase();
    if (u === "C") { m |= COLORLESS; continue; }
    const i = COLORS.indexOf(u as Color);
    if (i >= 0) m |= 1 << i;
  }
  return m;
}

/** A FETCHLAND IS A COLOUR FIXER AND A THINNER (owner, 2026-08-25). Cracking it searches the library,
 *  so two facts follow that a plain land does not have: you CHOOSE which land, so the fetch is a
 *  wildcard for whatever its fetchable set covers; and the fetched land LEAVES the library.
 *
 *  It is why `producedMana` looks incomplete on lands and is not: 2,500 of the 2,646 land slots in
 *  the 71 decks carry one, and the entire remainder is fetchlands, which correctly produce nothing
 *  of their own.
 *
 *  THE GATE IS `LAND_FETCH` FOR A LAND AND A SPELL ALIKE (roadmap N2, 2026-08-26). It used to demand
 *  the literal words "land card" on the land side, and the fetch cycle does not print them --
 *  Scalding Tarn says "an Island or Mountain CARD" -- so all ten real fetchlands fell through, 110
 *  of the 162 slots this correction reaches. One predicate, because the two sides ask the same
 *  question, and the land side gains `ONTO_BATTLEFIELD` with it: a search that puts the land in HAND
 *  is not a land drop. */
const BASIC_TYPES = ["plains", "island", "swamp", "mountain", "forest"] as const;

/** What a fetchland can find in THIS deck, as a colour mask.
 *
 *  ponytail: computed once off the whole deck, not per trial off the remaining library, so it
 *  over-claims slightly as the library empties. The alternative is recomputing a mask every crack. */
export function fetchMask(oracleText: string, deck: readonly { typeLine: string; producedMana?: readonly string[] }[]): number {
  const text = oracleText.toLowerCase();
  const named = BASIC_TYPES.filter((t) => text.includes(t));
  // NAMING A TYPE IS NOT DEMANDING A BASIC, and the two are independent (owner, 2026-08-25).
  // Scalding Tarn searches for "an Island or Mountain CARD", so it finds Steam Vents -- a
  // `Land - Island Mountain` -- and every other dual carrying one of those types, 20 lands in
  // `iz-it-izzet` rather than the 19 basics. Seething Landscape says "a BASIC Island, Swamp, or
  // Mountain card" and finds only basics. The word is read on its own, not as a fallback for a
  // fetch that names nothing. `nonbasic` needs no stripping -- `\b` does not match inside it, which
  // the test asserts rather than assumes, because it is exactly the kind of thing that stops being
  // true when someone "simplifies" the pattern.
  const wantsBasic = /\bbasic\b/.test(text);
  let m = 0;
  for (const c of deck) {
    const line = c.typeLine.toLowerCase();
    if (!line.includes("land")) continue;
    if (named.length > 0 && !named.some((t) => line.includes(t))) continue;
    if (wantsBasic && !line.includes("basic")) continue;
    m |= colorMask(c.producedMana);
  }
  return m;
}

/** CR 712.4a: A CARD IN HAND IS ITS FRONT FACE, so a transform card's land back can never be played
 *  as a land -- it is reached by transforming a permanent already on the battlefield. The type-line
 *  test alone took a phantom land drop on 10 distinct cards / 23 deck-slots (Treasure Map, Primal
 *  Amulet, Ojer Axonil, Dowsing Dagger and friends) and dropped each from the priced denominator.
 *  `land-count.ts` already makes this check; this module never learned it (roadmap N3).
 *
 *  AN ALLOW-LIST OF FRONT-FACE-ONLY LAYOUTS, never a reject-list -- the `FRONT_FACE_ONLY` precedent,
 *  so the next layout printed keeps today's reading rather than being silently narrowed. A MODAL DFC
 *  keeps its land face, because you really do play that side: 28 distinct cards / 186 slots. */
const FRONT_FACE_ONLY = new Set(["transform", "flip"]);
function frontTypeLine(typeLine: string | undefined, layout: string | undefined): string {
  const line = typeLine ?? "";
  return layout && FRONT_FACE_ONLY.has(layout) ? line.split("//")[0] : line;
}

/** One coloured requirement of a mana cost, as the set of colours that may pay it. A mono pip is one
 *  colour; a hybrid or Phyrexian pip is either colour it names — which is why `pipsByColor` is not
 *  reused here: it counts `{B/R}` against BOTH, correct for "does the deck have the sources" and
 *  wrong for "can this hand pay the cost". */
export interface Cost { total: number; pips: number[] }
export function parseCost(manaCost: string | undefined): Cost | null {
  if (!manaCost) return null;
  let total = 0;
  const pips: number[] = [];
  for (const symbol of manaCost.match(/\{[^}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1).toUpperCase();
    if (inner.includes("X")) return null; // an X cost is not a number; `castability.ts` refuses it too
    const parts = inner.split("/");
    const n = Number(parts.find((x) => /^\d+$/.test(x)));
    if (Number.isFinite(n) && parts.length === 1) { total += n; continue; }
    total += 1;
    // A COLORLESS HYBRID IS COLOURLESS *OR* ITS COLOUR, and it used to constrain nothing at all --
    // `{C/W}` was read as "any source pays it", which is a WIDER claim than the card makes. Ulalek,
    // Fused Atrocity costs `{C/W}{C/U}{C/B}{C/R}{C/G}`: read as a WUBRG demand it priced a colourless
    // Eldrazi deck's own commander at 6%, and read as unconstrained it would let five Forests cast
    // it. With the sixth bit both halves are just true (roadmap N11).
    //
    // A NUMERIC hybrid (`{2/W}`) keeps its colour: the generic alternative costs MORE, so demanding
    // the colour is the under-claiming direction, which is the one this repo takes.
    const mask = colorMask(parts.filter((x) => x === "C" || (COLORS as readonly string[]).includes(x)));
    if (mask !== 0) pips.push(mask); // {S} and a generic-hybrid half still reach no colour
  }
  return { total, pips };
}

/** CAN THIS BOARD PAY THIS COST — a FEASIBILITY question, never a product of per-pip probabilities.
 *
 *  `castability.ts` refuses to multiply its two axes because both are driven by the same lands and
 *  the product under-estimates. Asking the board directly removes the question: the correlation is
 *  handled by construction.
 *
 *  Bipartite feasibility (Gale/Hall): payable iff total supply covers the total cost AND, for every
 *  subset S of the SIX mana types (WUBRG plus colourless, N11), the pips that ONLY S can pay do not
 *  exceed the supply that can produce something in S. 63 subsets, and only those inside the cost's
 *  own types can bind -- a `{2}{U}` card costs one subset test, not 63. */
export function payable(sources: readonly { mana: number; colors: number }[], cost: Cost): boolean {
  let total = 0;
  for (const s of sources) total += s.mana;
  if (total < cost.total) return false;
  if (cost.pips.length === 0) return true;
  let union = 0;
  for (const p of cost.pips) union |= p;
  for (let sub = union; sub > 0; sub = (sub - 1) & union) {
    let demand = 0;
    for (const p of cost.pips) if ((p & ~sub) === 0) demand++;
    if (demand === 0) continue;
    let supply = 0;
    for (const s of sources) if ((s.colors & sub) !== 0) supply += s.mana;
    if (supply < demand) return false;
  }
  return true;
}

/** EVERY FETCH PRINTS "THEN SHUFFLE" -- verified against corpus text on Farseek, Cultivate,
 *  Nature's Lore, Evolving Wilds, Fabled Passage and Scalding Tarn -- so the residual library
 *  is exchangeable and the land that leaves is UNIFORMLY RANDOM. Taking the earliest one in draw
 *  order systematically pushes the survivors later -- provable on `{L,L,X}`, where removing the
 *  first L leaves X ahead of the surviving L two thirds of the time instead of half -- and it cost
 *  +1.90pp of P(>=6 mana at T6) averaged over the 71 decks, up in 57 of them (roadmap N15). */
export function takeRandomLand(library: { isLand: boolean }[], random: () => number): void {
  const at: number[] = [];
  for (let i = 0; i < library.length; i++) if (library[i].isLand) at.push(i);
  if (at.length === 0) return;
  library.splice(at[Math.floor(random() * at.length)], 1);
}

interface DeckSlot {
  name: string;
  manaValue: number;
  typeLine: string;
  isLand: boolean;
  output: ManaOutput;
  everyLandType: boolean;
  /** Colours this source can make, as a mask. A fetchland carries what it can FIND. */
  colors: number;
  /** The card's own cost, parsed once. `null` for a land or an X cost. */
  cost: Cost | null;
  /** Costs are deduped per trial-turn on this key -- 270 distinct across all 71 decks. */
  costKey: string;
  /** Priced but not shuffled in -- a commander. Excluded from the deck's payable SHARE. */
  isExtra?: boolean;
  /** A fetchland removes the land it finds from the library. */
  fetches: boolean;
  /** The land this fetch FINDS arrives tapped -- Evolving Wilds and the Landscape cycle. */
  fetchTapped?: boolean;
  /** ...unless you already control this many lands: Fabled Passage's own untap clause. */
  fetchUntapsAt?: number;
  land?: LandCondition;
  accelerant?: Accelerant | null;
}

export interface SimulateOptions {
  trials?: number;
  turns?: number;
  seed?: number;
  podSize?: number;
  /** THE ALTERNATIVE POLICY ARM, and the only knob in this module (C8). Mana the player keeps back
   *  before casting an accelerant — the owner's own decks hold up interaction, and rule 3's greedy
   *  spend never does. NOT A TUNING SURFACE: it exists to SIZE the policy error, and if that error
   *  rivals the ramp signal the point readout is withdrawn and an interval ships. */
  holdUp?: number;
  /** Cards to PRICE without shuffling in — a commander, which is not in the library (CR 903.6) and
   *  is still the one card a reader looks for by name. */
  alsoPrice?: readonly DeckCard[];
}

export interface SimulateResult {
  trials: number;
  turns: number;
  /** Per turn (1-indexed into `[turn - 1]`), one entry per trial: the mana the board could TAP.
   *
   *  PRODUCTION, NOT WHAT IS LEFT AFTER THE POLICY SPENDS. Rule 3 casts accelerants greedily, so in
   *  a trial where mana went into a rock that same mana is not also available for a spell — which is
   *  exactly why §7 calls every output here a CEILING UNDER A MANA-MAXIMISING POLICY rather than an
   *  expectation. A player who wants to cast a spell simply does not cast the rock. */
  manaAt: number[][];
  /** Per turn, per trial: the share of the deck's NONLANDS whose mana value this trial could pay.
   *
   *  COMPUTED INSIDE THE TRIAL, which is the whole point — the original design glued "median mana
   *  that turn" to "share of nonlands at or under it", two medians from different distributions
   *  presented as one fact, and a reader multiplies them. Named `payableShareAt` and never
   *  `castableShare`: the model is colour-blind, and a field name is exactly where a banned word
   *  creeps back in. */
  payableShareAt: number[][];
  /** Per card, per turn: P(the board could pay this card's WHOLE cost, colours included. This one IS
   *  castability: the two axes `castability.ts` refuses to multiply are asked of the same board in
   *  the same trial, so the correlation between them is handled by construction. A card with an X
   *  cost reads 0 and is refused upstream, exactly as `castability.ts` refuses it. */
  byCardCastable: Map<string, number[]>;
  /** Per card, per turn: P(the board could tap at least that card's mana value by then). Still not
   *  "castable" — see the colour ceiling. */
  byCard: Map<string, number[]>;
}

/** Lands on the battlefield, as a conditional land reads them at the moment it would enter. */
interface OnBoardLand { cond: LandCondition; enteredTurn: number; enteredTapped: boolean; typeLine: string; output: ManaOutput; everyLandType: boolean; colors: number }

function boardFor(lands: OnBoardLand[], pod: number): { lands: number; basics: number; types: Set<string>; opponents: number } {
  const types = new Set<string>();
  let basics = 0;
  for (const l of lands) {
    const line = l.typeLine.toLowerCase();
    for (const t of ["plains", "island", "swamp", "mountain", "forest"]) if (line.includes(t)) types.add(t);
    if (line.includes("basic")) basics++;
  }
  return { lands: lands.length, basics, types, opponents: opponents(pod) };
}

export function simulate(deck: readonly DeckCard[], opts: SimulateOptions = {}): SimulateResult {
  // `alsoPrice` cards are COSTED but never SHUFFLED IN. A commander is not in the library (CR 903.6)
  // and yet "can I cast my commander on turn six" is the one question a reader looks for by name.
  // They are excluded from `payableShareAt`, which is a share OF THE DECK.
  const trials = opts.trials ?? 20_000;
  const turns = opts.turns ?? 8;
  const pod = opts.podSize ?? DEFAULT_POD_SIZE;
  const random = rng(opts.seed ?? 1);
  const holdUp = opts.holdUp ?? 0;

  const printed = deck.map((dc) => ({ typeLine: dc.card.typeLine ?? "", producedMana: dc.card.producedMana }));
  const slots: DeckSlot[] = deck.map((dc) => {
    const isLand = /\bland\b/i.test(frontTypeLine(dc.card.typeLine, dc.card.layout));
    const text = dc.card.oracleText ?? "";
    // A land-fetch SPELL searches the library too, so it fixes colours and thins by the same fact.
    const fetches = LAND_FETCH.test(text) && ONTO_BATTLEFIELD.test(text) && !fetchCostsMana(text);
    return {
      name: dc.card.name,
      manaValue: dc.card.manaValue ?? 0,
      typeLine: dc.card.typeLine ?? "",
      isLand,
      output: manaOutput(dc.card.oracleText),
      everyLandType: isEveryLandType(dc.card.typeLine, dc.card.oracleText),
      colors: fetches ? fetchMask(text, printed) : colorMask(dc.card.producedMana),
      fetches,
      fetchTapped: fetches && FETCHES_TAPPED.test(text),
      ...(fetches && FETCH_UNTAPS.test(text) ? { fetchUntapsAt: 3 } : {}),
      cost: isLand ? null : parseCost(dc.card.manaCost),
      costKey: dc.card.manaCost ?? "",
      ...(isLand ? { land: classifyLand(dc.card) } : { accelerant: classifyAccelerant(dc) }),
    };
  });
  const nonlands = slots.filter((s) => !s.isLand);
  const extras: DeckSlot[] = (opts.alsoPrice ?? []).map((dc) => ({
    name: dc.card.name,
    manaValue: dc.card.manaValue ?? 0,
    typeLine: dc.card.typeLine ?? "",
    isLand: false,
    output: { amount: 1 },
    everyLandType: false,
    colors: 0,
    fetches: false,
    cost: parseCost(dc.card.manaCost),
    costKey: dc.card.manaCost ?? "",
    accelerant: null,
    isExtra: true,
  }));
  const priced = [...nonlands, ...extras];
  // A PROBABILITY IS PER CARD, NOT PER COPY (roadmap N1). `byCardHits` keys on NAME, so a deck
  // running 30 Dragon's Approach accumulated 30 hits per trial-turn and printed 2,934%. The event
  // "this card is castable" is a property of the board and the COST, which every copy shares, so it
  // is counted on the first slot of each name and skipped on the rest. `affordable` below still
  // counts every copy, deliberately: that share really is 30 castable cards of 99.
  const seenName = new Set<string>();
  const countsForByCard = priced.map((s) => { const first = !seenName.has(s.name); seenName.add(s.name); return first; });

  const manaAt: number[][] = Array.from({ length: turns }, () => [] as number[]);
  const payableShareAt: number[][] = Array.from({ length: turns }, () => [] as number[]);
  const byCardHits = new Map<string, number[]>();
  const byCardCastHits = new Map<string, number[]>();
  for (const s of priced) {
    if (!byCardHits.has(s.name)) byCardHits.set(s.name, Array(turns).fill(0));
    if (!byCardCastHits.has(s.name)) byCardCastHits.set(s.name, Array(turns).fill(0));
  }

  for (let t = 0; t < trials; t++) {
    const library = [...slots];
    // Fisher-Yates against the seeded generator, so a run is reproducible card-for-card.
    for (let i = library.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [library[i], library[j]] = [library[j], library[i]];
    }
    const hand: DeckSlot[] = library.splice(0, 7);
    const lands: OnBoardLand[] = [];
    const rocks: { turn: number; mana: number; colors: number }[] = [];   // the turn each landed, what it taps for, and in which colours
    const dorks: { turn: number; mana: number; colors: number }[] = [];

    for (let turn = 1; turn <= turns; turn++) {
      // Rule 1: one card per turn, INCLUDING turn 1. On the play there is no turn-1 draw; modelling
      // the draw is the flattering direction by one card and is stated rather than hidden.
      const drawn = library.shift();
      if (drawn) hand.push(drawn);

      // Rule 2: one land per turn, preferring whichever enters UNTAPPED given the board right now —
      // and never a land whose own gate is unmet, because that is not a land drop, it is a blank.
      // TEMPLE OF THE FALSE GOD IS PLAYED AS YOUR FIFTH LAND (owner, 2026-08-25) and no earlier: it
      // taps for nothing under five lands, so playing it turn one costs a whole turn of mana. The
      // gate counts the land itself, hence `lands.length + 1`.
      // GREEDY AND OCCASIONALLY WRONG BEYOND THAT — a player with spare mana banks the untapped land
      // and plays the tapped one first. Direction pessimistic, and small.
      const board = boardFor(lands, pod);
      const blank = (c: DeckSlot): boolean =>
        c.output.needsLands !== undefined && lands.length + 1 < c.output.needsLands;
      const live = (c: DeckSlot): boolean => c.isLand && !blank(c);
      const idx = [
        hand.findIndex((c) => live(c) && c.land !== undefined && !entersTapped(c.land, board)),
        hand.findIndex(live),
        hand.findIndex((c) => c.isLand),
      ].find((i) => i >= 0) ?? -1;
      if (idx >= 0) {
        const played = hand.splice(idx, 1)[0];
        lands.push({
          cond: played.land!,
          enteredTurn: turn,
          // WHAT IS STANDING THERE IS THE FETCHED LAND, so its tapped state is the one that counts --
          // the fetch itself is sacrificed. Fabled Passage untaps it at four lands, which is measured
          // against the board BEFORE this drop, hence three (roadmap N12).
          enteredTapped: played.fetches
            ? played.fetchTapped === true
              && !(played.fetchUntapsAt !== undefined && board.lands >= played.fetchUntapsAt)
            : entersTapped(played.land!, board),
          typeLine: played.typeLine,
          output: played.output,
          everyLandType: played.everyLandType,
          colors: played.colors,
        });
        // A FETCHLAND TAKES ITS LAND OUT OF THE DECK (owner, 2026-08-25). Board +1 land, library -1
        // land, which is what cracking one actually does -- the fetch itself taps for nothing and
        // the land it finds is what is standing there.
        if (played.fetches) {
          takeRandomLand(library, random);
        }
      }

      // A land contributes unless it entered TAPPED this very turn. A rock pays the turn it lands
      // (CR 302.6); a dork waits one.
      const untappedSources = (): { mana: number; colors: number }[] => {
        const out: { mana: number; colors: number }[] = [];
        for (const l of lands) {
          if (l.enteredTapped && l.enteredTurn === turn) continue;
          const m = produced(l.output, lands);
          if (m > 0) out.push({ mana: m, colors: l.colors });
        }
        for (const r of rocks) if (r.turn <= turn) out.push({ mana: r.mana, colors: r.colors });
        for (const d of dorks) if (d.turn < turn) out.push({ mana: d.mana, colors: d.colors });
        return out;
      };
      const production = (): number => untappedSources().reduce((n: number, x) => n + x.mana, 0);

      // Rule 3: spend on accelerants, cheapest first, greedily. THIS RULE DOES NEARLY ALL THE WORK,
      // and it is what makes every output a ceiling: the owner's own decks hold mana up for
      // interaction, and this one never does.
      //
      // THE TIE-BREAK AT EQUAL MANA VALUE IS HAND ORDER, i.e. the shuffle (roadmap N18). A rock and a
      // dork both costing two produce different boards -- the rock pays the turn it lands per
      // CR 302.6, the dork waits -- so which one goes first is a POLICY choice, and in a module whose
      // whole thesis is that the policy IS the model it is stated rather than left implicit. It is
      // not a defect: the order is uniformly random across trials, so it averages rather than biases,
      // and preferring the rock would be a THIRD policy arm, not a fix.
      let pool = production();
      for (;;) {
        let best = -1;
        for (let i = 0; i < hand.length; i++) {
          const a = hand[i].accelerant;
          if (!a || hand[i].manaValue > pool - holdUp) continue;
          if (best < 0 || hand[i].manaValue < hand[best].manaValue) best = i;
        }
        if (best < 0) break;
        const cast = hand.splice(best, 1)[0];
        pool -= cast.manaValue;
        const a = cast.accelerant!;
        const mana = produced(cast.output, lands);
        if (a.kind === "rock") { rocks.push({ turn, mana, colors: cast.colors }); pool += mana; }
        else if (a.kind === "dork") dorks.push({ turn, mana, colors: cast.colors });
        else {
          // A FETCHED LAND DOES NOT CONSUME THE LAND DROP — it is put onto the battlefield, not
          // played — and it follows its own tapped state, which the spell's text states.
          // A FETCHED LAND'S IDENTITY IS UNKNOWN TO THIS MODEL — the spell says "a basic land" or
          // "a Forest" and the trial never chooses one. It counts as a LAND and as NEITHER a basic
          // nor a type, which is the pessimistic direction for every other conditional land on the
          // board: fewer suppliers means more of them enter tapped. Stated rather than guessed.
          // A FETCHED LAND'S IDENTITY IS UNKNOWN, but its COLOUR is not: the spell names what it may
          // find, and `fetchMask` reads that against the lands this deck actually holds.
          lands.push({ cond: { template: "none", subtypes: [], bounces: false }, enteredTurn: turn, enteredTapped: a.fetchTapped === true, typeLine: "", output: { amount: 1 }, everyLandType: false, colors: cast.colors });
          takeRandomLand(library, random);
          if (a.fetchTapped !== true) pool += 1;
        }
      }

      const untapped = untappedSources();
      const made = untapped.reduce((n, x) => n + x.mana, 0);
      manaAt[turn - 1].push(made);
      // COLOUR IS ASKED OF THE BOARD, ONCE PER DISTINCT COST. A cost the board cannot pay is not a
      // second probability to multiply in -- it is this trial answering no.
      const castableByCost = new Map<string, boolean>();
      let affordable = 0;
      for (let i = 0; i < priced.length; i++) {
        const s = priced[i];
        if (s.manaValue > made) continue;
        if (!s.isExtra) affordable++;
        if (countsForByCard[i]) byCardHits.get(s.name)![turn - 1]++;
        if (s.cost === null) continue;
        let ok = castableByCost.get(s.costKey);
        if (ok === undefined) { ok = payable(untapped, s.cost); castableByCost.set(s.costKey, ok); }
        if (ok && countsForByCard[i]) byCardCastHits.get(s.name)![turn - 1]++;
      }
      payableShareAt[turn - 1].push(nonlands.length > 0 ? affordable / nonlands.length : 0);
    }
  }

  const byCard = new Map<string, number[]>();
  for (const [name, hits] of byCardHits) byCard.set(name, hits.map((h) => h / trials));
  const byCardCastable = new Map<string, number[]>();
  for (const [name, hits] of byCardCastHits) byCardCastable.set(name, hits.map((h) => h / trials));
  return { trials, turns, manaAt, payableShareAt, byCard, byCardCastable };
}

/** P(at least `m` mana by turn `t`) straight off a run. */
export function pAtLeastMana(result: SimulateResult, m: number, turn: number): number {
  const col = result.manaAt[turn - 1] ?? [];
  return col.length === 0 ? 0 : col.filter((v) => v >= m).length / col.length;
}

/** The spread, never just the middle — a median with no p25/p75 beside it invites the reader to
 *  treat a distribution as a number. */
export function quantiles(values: readonly number[]): { p25: number; median: number; p75: number } {
  if (values.length === 0) return { p25: 0, median: 0, p75: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
}

/** Trials the REPORT runs at, against the 20k the bin uses.
 *
 *  CHOSEN AGAINST THE WIDTH OF THE THING IT SITS INSIDE, which is the only defensible way to pick a
 *  Monte Carlo sample size. The POLICY interval it is reported inside has a median width of 7.0pp,
 *  and the sampling noise at 2,000 trials is well under that: **SD 0.83-1.22pp (median 1.03) across
 *  10 decks x 20 seeds, with the worst single excursion from the 20,000-trial answer at 3.6pp**
 *  (roadmap N5, re-measured 2026-08-26). This comment used to claim "within about 0.5pp", which is
 *  optimistic by 2x on the SD and 7x on the tail; the CONCLUSION survives the correction and the
 *  sentence did not. A figure that prints as a whole percent inside a 7pp band can carry a 1pp SE;
 *  raising the trial count on this alone would buy accuracy nothing reads.
 *  Measured cost: about 24ms per policy arm on a 99-card deck, so ~48ms on an analyze request. */
export const REPORT_TRIALS = 2_000;

/** The availability TABLE is eight rows. The simulation may run longer to price a big card. */
const ROW_TURNS = 8;
/** Past this a card is refused rather than priced — a longer simulation is not a better answer when
 *  nothing here models a game that goes that long. */
export const MAX_PRICED_TURN = 12;

export interface ManaAvailabilityRow {
  turn: number;
  /** Mana the board could tap, under the spend-everything policy: median with p25/p75 beside it.
   *
   *  THE MEDIAN IS POLICY-INSENSITIVE AND THE TAIL IS NOT, which is a finding rather than a
   *  convenience and is why this row is not itself a policy interval. Measured on `samut.txt`: the
   *  two policies agree on the median at every one of the eight turns, while P(>= 6 mana at turn 6)
   *  moves by up to 27.6pp across the corpus. Reporting a policy interval HERE would print
   *  "15% - 15%" eight times and hide the sensitivity somewhere the reader never looks; the headline
   *  below is computed on the quantity that actually moves. */
  mana: { median: number; p25: number; p75: number };
  /** Share of the deck's nonlands this turn could PAY for. Median with p25/p75.
   *
   *  COMPUTED IN-TRIAL, never as "median mana" glued to "share of nonlands at or under it". Those
   *  are two medians from different distributions and a reader multiplies them; §9 refuses that
   *  chart outright and this is the arithmetic that replaces it. */
  payableShare: { median: number; p25: number; p75: number };
}

export interface ManaAvailability {
  trials: number;
  /** Accelerants the deck runs, by the printed-data classifier. */
  accelerants: number;
  rows: ManaAvailabilityRow[];
  /** THE ONE QUANTITY THE POLICY MOVES, and therefore the one reported as an INTERVAL: P(the board
   *  could tap `mana` by `turn`), from the hold-up-2 policy to the spend-everything ceiling. This is
   *  the cell the whole-item falsifier was measured on. */
  headline: { mana: number; turn: number; low: number; high: number };
}

/** THE REPORT SHAPE, and it is an INTERVAL because the point readout was WITHDRAWN.
 *
 *  The item's own falsifier fired: policy sensitivity measured 27.6pp against a 32.7pp median ramp
 *  signal, so mana availability is a POLICY property at this deck's scale. The two arms are the two
 *  policies — spend-everything is a CEILING, hold-up-2 is nearer how a deck is actually played — and
 *  any renderer of this owes the reader both ends and neither alone.
 *
 *  IT IS NOT THE PER-CARD CASTABILITY FIGURE and must never be shown as a better version of it.
 *  `castability.ts` is COLOUR-AWARE and counts lands (or lands plus already-castable rocks); this is
 *  COLOUR-BLIND and models ramp and tapped lands. Neither contains the other, and the measured fact
 *  is that castability's interval does not contain this model's answer on a green land-ramp deck. */
export function manaAvailability(
  deck: readonly DeckCard[],
  opts: { trials?: number; turns?: number; seed?: number } = {},
): ManaAvailability {
  return manaModel(deck, opts).availability;
}

/** P(you can cast this card by turn N), as the POLICY interval — plus the same cell with COLOURS
 *  IGNORED, which is the diagnostic. A card whose `mana` is high and whose `castable` is low has a
 *  colour problem and not a ramp problem, and that is a different thing to fix.
 *
 *  This is what replaced `castability.ts`'s two hypergeometric axes. Those could never be combined:
 *  both were driven by the same lands, so their product under-states, and `pAtLeast` never caps land
 *  drops. Asking the BOARD makes the combination free. */
export interface CastCurve {
  /** Indexed by `turn - 1`. */
  castable: { low: number; high: number }[];
  mana: { low: number; high: number }[];
}

export interface ManaModel {
  availability: ManaAvailability;
  /** By card name, for every nonland in the library plus everything in `alsoPrice`. */
  curves: Map<string, CastCurve>;
  turns: number;
}

/** BOTH POLICIES, RUN ONCE. `analyze` needs the availability table AND every card's castability, and
 *  running four simulations for two answers off the same trials would be pure waste. */
export function manaModel(
  deck: readonly DeckCard[],
  opts: { trials?: number; turns?: number; seed?: number; alsoPrice?: readonly DeckCard[] } = {},
): ManaModel {
  const trials = opts.trials ?? REPORT_TRIALS;
  const seed = opts.seed ?? 20260822;
  const alsoPrice = opts.alsoPrice ?? [];
  // EIGHT TURNS UNLESS THE DECK HOLDS SOMETHING BIGGER. A ten-drop priced "by turn 8" would be a
  // different question answered quietly, so the run is extended to reach it — and capped, because
  // past twelve the honest answer is a refusal rather than a longer simulation.
  const biggest = Math.max(0, ...[...deck, ...alsoPrice].map((dc) => Math.round(dc.card.manaValue ?? 0)));
  const turns = opts.turns ?? Math.min(MAX_PRICED_TURN, Math.max(ROW_TURNS, biggest));
  const greedy = simulate(deck, { trials, turns, seed, alsoPrice });
  const held = simulate(deck, { trials, turns, seed, holdUp: 2, alsoPrice });
  const rows: ManaAvailabilityRow[] = [];
  for (let t = 1; t <= Math.min(ROW_TURNS, turns); t++) {
    const g = quantiles(greedy.manaAt[t - 1]);
    const h = quantiles(held.manaAt[t - 1]);
    const gs = quantiles(greedy.payableShareAt[t - 1]);
    const hs = quantiles(held.payableShareAt[t - 1]);
    void h; void hs;
    rows.push({
      turn: t,
      mana: { median: g.median, p25: g.p25, p75: g.p75 },
      payableShare: { median: gs.median, p25: gs.p25, p75: gs.p75 },
    });
  }
  // Six mana on turn six — the cell §5's measured failure lives at, and the cell the falsifier was
  // measured on. Not swept.
  const lo = pAtLeastMana(held, 6, 6), hi = pAtLeastMana(greedy, 6, 6);
  const band = (a: number, b: number): { low: number; high: number } =>
    ({ low: Math.min(a, b), high: Math.max(a, b) });
  const curves = new Map<string, CastCurve>();
  for (const [name, g] of greedy.byCardCastable) {
    const h = held.byCardCastable.get(name) ?? g;
    const gm = greedy.byCard.get(name) ?? g;
    const hm = held.byCard.get(name) ?? gm;
    curves.set(name, {
      castable: g.map((p, i) => band(p, h[i] ?? p)),
      mana: gm.map((p, i) => band(p, hm[i] ?? p)),
    });
  }
  return {
    turns,
    curves,
    availability: {
      trials,
      accelerants: deck.map(classifyAccelerant).filter((a) => a !== null).length,
      rows,
      headline: { mana: 6, turn: 6, low: Math.min(lo, hi), high: Math.max(lo, hi) },
    },
  };
}
