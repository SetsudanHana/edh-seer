import { POLICY_COLLAPSE } from "@edh-seer/engine/percent";
import type { DeckCard } from "./types.js";
import { castableManaCost } from "./split-cost.js";
import { COLORS, isManaSource, type Color } from "./mana-audit.js";
import { classifyLand, entersTapped, type LandCondition } from "./land-conditions.js";
import { FETCHES_TAPPED, FETCH_UNTAPS, FETCH_UNTAP_LANDS, fetchableLands, isLandFetch } from "./fetch-land.js";
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

const SUSPEND = /\bsuspend \d/i;
/** A TAP-REPLACEMENT: mana that arrives when some OTHER permanent is tapped (roadmap O2). Two shapes,
 *  and they are not the same size -- a land AURA is bounded at what its one enchanted land adds,
 *  while Forsaken Monument pays for EVERY permanent tapped for {C} and is worth as much as the board
 *  is wide. High Tide prints the same shape and is refused elsewhere for being an Instant. */
const TAP_REPLACEMENT = /is tapped for mana|tap a (?:permanent|creature|land)\b[^.]*\bfor\b/i;
/** Which sources a per-source bonus reads. `colorless` is checkable only because `{C}` became a real
 *  mask bit (N11); before that a colourless source and a colourless COST were the same empty mask. */
const BONUS_COLORLESS = /tap a permanent for \{c\}|tap a land for \{c\}/i;
const BONUS_CREATURE = /tap a creature for mana/i;

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
  if (isLandFetch(text)) {
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
  // A LAND AURA WAITS A TURN, because the land it enchants is what pays for it: you tap the Forest
  // for {G}, cast Wild Growth on it, and the Forest is tapped. That is a DORK's timing, and pricing
  // it as a rock gave the deck a mana it does not have on the turn it matters most (roadmap O2).
  const tapReplacement = TAP_REPLACEMENT.test(text);
  if (tapReplacement && /\baura\b/.test(line)) return { name, manaValue, kind: "dork" };
  // A PHASE TRIGGER PAYS FROM THE NEXT TURN, whatever its type line says: you cast it DURING your
  // first main phase, so that turn's trigger has already happened. Dork timing, for the same reason
  // a land aura has it (roadmap O2).
  if (PHASE_ADD.test(text) && !PHASE_ONE_SHOT.test(text)) return { name, manaValue, kind: "dork" };
  // LANDFALL MANA MISSES THE TURN IT LANDS: rule 2 plays the land BEFORE rule 3 casts anything, so
  // the land drop that turn has already happened. Dork timing, same as the others.
  if (landfallMana(text) > 0) return { name, manaValue, kind: "dork" };
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
  /** This mana may be spent only on spells at or above this mana value (roadmap O1). It is counted
   *  ONLY when the deck makes the restriction vacuous, which `simulate` settles. */
  needsMinMV?: number;
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
const ADD_RUN = /add ((?:\{[^{}]+\}\s*)+)/i;
/** THE SAME AMOUNT IN WORDS, which the symbol reader cannot see: "Add three mana of any one color"
 *  (roadmap N10). **Sceptre of Eternal Glory is in 11 decks and was priced at one.** `X` is
 *  deliberately absent -- it is a RATE and not an amount, the ruling I4 already made one subsystem
 *  over -- so a card that adds X keeps the incumbent 1 rather than a guess. */
const ADD_WORDS = /add (one|two|three|four|five|six|seven|eight|nine|ten) mana\b/i;
/** A TAP-REPLACEMENT: the mana arrives when some OTHER permanent is tapped, so there is no `{T}:` to
 *  read and the amount sits in a sentence the tap reader never looks at (roadmap O2). Overgrowth adds
 *  `{G}{G}`, Wild Growth one, Fertile Ground "an additional one mana of any color". */
const ADD_ADDITIONAL = /adds? an additional (?:((?:\{[^{}]+\}\s*)+)|(one|two|three) mana)/i;
/** A PHASE TRIGGER: mana that arrives every turn without tapping anything, so again there is no
 *  `{T}:` to read (roadmap O2). **The GUARDS are most of this rule.** Of 32 corpus cards printing the
 *  shape, nearly all add a RATE -- "for each Raccoon you control", "for each charge counter" -- which
 *  the "a rate is not an amount" ruling refuses (I4, one subsystem over); six RESTRICT the mana, which
 *  this model cannot check; and two are ONE-SHOTS wearing a trigger, where "your NEXT main phase"
 *  (Mana Drain) and "first main phase OF THE GAME" (Chancellor of the Tangle) each fire once. A
 *  one-shot is not a source at any confidence -- `isManaSource`'s own ruling. */
const PHASE_ADD = /at the beginning of[^.]{0,80}?\badds? ((?:\{[^{}]+\}\s*)+|(?:one|two|three|four) mana)/i;
/** THE ONE RESTRICTION THIS MODEL CAN CHECK (roadmap O1). Every other "spend this mana only to cast
 *  X" names a colour or a type the module is blind to, so it refuses them; a MANA VALUE threshold is
 *  different, because it knows every card's. **`iz-it-izzet` is built so it binds nothing -- all 62 of
 *  its nonlands are mana value 4 or greater** -- and that is a construction the report should be able
 *  to see. Settled against the DECK in `simulate`, since a cue alone cannot know it. */
const MV_RESTRICTION = /spend this mana only to cast spells with mana value (\d+) or greater/i;
const PHASE_ONE_SHOT = /at the beginning of your next|first main phase of the game/i;
/** LANDFALL MANA, and it is the ONLY event-triggered mana this simulator can price (roadmap O2).
 *  Classified corpus-wide by whether the model PRODUCES the event: a land entering is rule 2 and
 *  happens every turn a land drop does, plus every fetch. The other buckets are refused because the
 *  event does not exist here -- COMBAT (the Azulas, Fire Nation Occupation), an OPPONENT (Waste Not),
 *  a BOARD EVENT (Carnival of Souls, Rose), and YOU CAST A SPELL (Birgi), where rule 3 casts only
 *  ACCELERANTS, so pricing off that stream would read a fraction of a real deck's spells AND feed
 *  back into the casting loop it came from. */
const LANDFALL_ADD = /whenever a land (?:you control |)enters(?: the battlefield under your control|)[^.]{0,30}?adds? ((?:\{[^{}]+\}\s*)+|one mana|two mana)/i;
const PHASE_RATE = /\bfor each\b|\bwhere x is\b|equal to/i;
/** UNREACHABLE ON TODAY'S CORPUS AND KEPT ANYWAY, recorded rather than quietly shipped as decoration:
 *  `PHASE_ADD` demands a symbol run, and NO corpus card prints a multi-symbol rate ("add {G}{G} for
 *  each Elf"). Every rate in the family adds ONE symbol per unit, so refusing it changes no number
 *  today -- the guard exists because the shape is printable and the failure would be an over-claim. */
const SYMBOLS = /\{[^{}]+\}/g;
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
const TRON = /if you control (?:an?|the) ([^,]{1,40}?) and (?:an?|the) ([^,]{1,40}?), add ((?:\{[^{}]+\})+) instead/i;
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
  // A TAP-REPLACEMENT has no `{T}:` line to find, so it is read before the loop and never inside it.
  const extra = ADD_ADDITIONAL.exec(text);
  if (extra && !RESTRICTED.test(text)) {
    out = { amount: extra[1] ? (extra[1].match(SYMBOLS) ?? []).length : WORD_NUMBER[extra[2].toLowerCase()] };
  }
  // A PHASE TRIGGER, on the same footing and behind the same three guards.
  // THE RATE TEST READS THE WHOLE SENTENCE, not the match: `PHASE_ADD` stops at the symbol run, so
  // Muerra's "for each Raccoon you control" sits AFTER it and a guard tested on `phase[0]` cannot see
  // the words it exists for. Caught by a corpus probe, which is the only thing that would have.
  // A MANA VALUE restriction is RECORDED rather than refused, because the deck can settle it.
  const phase = PHASE_ADD.exec(text);
  const sentence = phase ? (text.slice(phase.index).split(/(?<=\.)\s/)[0] ?? "") : "";
  const mv = MV_RESTRICTION.exec(text);
  if (phase && !(RESTRICTED.test(text) && !mv) && !PHASE_ONE_SHOT.test(text) && !PHASE_RATE.test(sentence)) {
    const n = phase[1].startsWith("{")
      ? (phase[1].match(SYMBOLS) ?? []).length
      : WORD_NUMBER[phase[1].split(" ")[0].toLowerCase()];
    if (n > out.amount) out = { amount: n, ...(mv ? { needsMinMV: Number(mv[1]) } : {}) };
  }
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

/** Mana a card adds per LAND ENTERING, or 0. Refused when the mana is restricted, for the same
 *  reason every other restricted source is: this model cannot check what mana is spent on. */
function landfallMana(text: string): number {
  const m = LANDFALL_ADD.exec(text);
  if (!m || RESTRICTED.test(text)) return 0;
  return m[1].startsWith("{") ? (m[1].match(SYMBOLS) ?? []).length : (m[1].startsWith("two") ? 2 : 1);
}

/** A source whose mana carries a mana-value restriction the DECK does not make vacuous is worth what
 *  it was before that restriction was read -- one. Under-claiming, which is the direction this module
 *  takes everywhere it cannot check a restriction (roadmap O1). */
function spendable(o: ManaOutput, cheapestNonland: number): ManaOutput {
  if (o.needsMinMV === undefined) return o;
  const { needsMinMV, ...rest } = o;
  return cheapestNonland >= needsMinMV ? rest : { ...rest, amount: 1 };
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
 *  WHAT it can find is `fetch-land.ts`'s question, shared with `mana-audit.ts`; the MASK is this
 *  module's currency, so only the last line is here.
 *
 *  CEILING: computed once off the whole deck, not per trial off the remaining library, so it
 *  over-claims slightly as the library empties. The alternative is recomputing a mask every crack. */
export function fetchMask(oracleText: string, deck: readonly { typeLine: string; producedMana?: readonly string[] }[]): number {
  let m = 0;
  for (const c of fetchableLands(oracleText, deck)) m |= colorMask(c.producedMana);
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
  for (const symbol of manaCost.match(/\{[^{}]+\}/g) ?? []) {
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
    //
    // A PHYREXIAN pip (`{B/P}`) KEEPS ITS COLOUR TOO, AND THAT IS A REAL UNDER-CLAIM WITH A MEASURED
    // SIZE (roadmap N14). Its alternative is TWO LIFE, not mana, and nothing here has a life total --
    // the goldfish has no opponent, takes no damage and pays no life, so pricing the pip as free
    // would be a claim this model cannot support. So it demands the colour, and the cost is stated
    // rather than hidden: measured at each card's own mana-value turn across the 71 decks, paying the
    // life instead would read **+15 to +23pp on a single pip** (Phyrexian Metamorph 78% -> 94% in 4
    // decks, Tezzeret's Gambit, Jace the Perfected Mind) and **+23 to +52pp where the cost prints two
    // or three** -- Dismember `{1}{B/P}{B/P}` 51% -> 99% in `mari-takes-control`, K'rrik
    // `{4}{B/P}{B/P}{B/P}` 39% -> 91% in `gengar`. 6 distinct cards, 12 slots.
    // Same direction as `{2/W}`, a much bigger number, and now written down.
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

/** WHICH LAND TO PLAY, once tapped-ness has chosen the candidates: the one that unlocks the most
 *  COLOURS the hand is asking for and the board cannot yet make.
 *
 *  THE INFORMATION IS THE PLAYER'S OWN — what is in hand and what is on the board, never a future
 *  draw — which is what separates this from a policy that peeks. A player holding an Island and a
 *  Mountain with `{U}{U}` in hand plays the Island; the incumbent rule read tapped-ness and then
 *  HAND ORDER, i.e. the shuffle, so it played either one at random.
 *
 *  IT SCORES UNMET PIPS AND NOT CARDS. "How many cards in hand does this land make castable" is the
 *  question a player actually asks, and answering it means calling `payable` once per candidate per
 *  card per turn per trial; scoring the colour demand is one pass over the same information and
 *  gets the same answer wherever a colour is the thing that binds. A land that makes a card castable
 *  by adding the sixth MANA rather than the missing COLOUR is invisible to this rule, and that is
 *  the case the tapped-ness preference above already handles.
 *
 *  A TIE FALLS BACK TO HAND ORDER, so a deck with no colour tension is byte-identical to the rule
 *  this replaced. */
export function pickLand(
  candidates: readonly { colors: number }[],
  boardColors: number,
  demandPips: readonly number[],
): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < candidates.length; i++) {
    let score = 0;
    for (const pip of demandPips) {
      if ((pip & boardColors) === 0 && (pip & candidates[i].colors) !== 0) score++;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
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
  /** A tap-replacement that pays PER QUALIFYING SOURCE rather than once: Forsaken Monument reads
   *  every permanent tapped for {C}, Leyline of Abundance every creature tapped for mana. A land
   *  AURA is deliberately absent -- it enchants ONE land, so its bonus is its own amount and it is
   *  priced as an ordinary dork (roadmap O2). */
  tapBonus?: "colorless" | "creature";
  /** Mana per LAND ENTERING, which is one land drop a turn plus anything a fetch puts down. */
  landfall?: number;
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
  /** POOLING OFF, for the one test that has to disagree with it. Pooling is a claim about the model
   *  -- that a non-accelerant nonland reaches the trajectory ONLY through its pips -- and a claim
   *  nothing can contradict is not a claim. `goldfish.pooled.test.ts` runs both arms at high trial
   *  counts and holds them together, so the day someone gives such a card a second channel, that
   *  test goes red instead of the percentages going quietly wrong. */
  pooled?: boolean;
  /** FORCED-CONDITIONING MODE: place this card at a uniform position among the first
   *  `7 + forceTurn` library slots, so EVERY trial is a held-by-forceTurn trial for it, and count
   *  only its cells. Exact up to fetch advancement: a fetch removing a land ahead of the card can
   *  only pull it EARLIER, so {position <= 6+turn} is a sub-event of {drawn by turn} missing the
   *  ~0.1-0.3% of held trials where a later card was advanced in -- sized in the harness. */
  forceName?: string;
  forceTurn?: number;
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
  /** Per card, per turn: P(the board could pay this card's WHOLE cost, colours included) GIVEN THAT
   *  YOU HOLD IT. This one IS castability: the two axes `castability.ts` refuses to multiply are
   *  asked of the same board in the same trial, so the correlation between them is handled by
   *  construction. A card with an X cost reads 0 and is refused upstream.
   *
   *  CONDITIONAL, AND IT WAS NOT (T18b). The denominator was every trial, including the ~92% where
   *  the card was never drawn, so the figure answered "how often is this deck's turn-N board able to
   *  produce this cost" and was labelled as the card's own chance to be cast. It also read a board
   *  built by a land policy that was not trying to cast this card, because the card was not in hand
   *  to ask. Conditioning fixes both at once: `pickLand` sees the card's own pips exactly in the
   *  trials that now count. Measured on `Curse of Opulence`: 40.0% unconditional, 47.1% held.
   *
   *  THE DENOMINATOR IS SMALL AND `byCardHeld` CARRIES IT, because a singleton is in hand in roughly
   *  (6 + turn)/99 of trials. `castability.ts` refuses a card held fewer than `MIN_HELD_TRIALS` times
   *  rather than printing a percentage drawn from a hundred shuffles -- a gate this comment claimed
   *  from T18b onwards and which was only BUILT on 2026-09-04. Until then nothing read the
   *  denominator at all and `REPORT_TRIALS` was silently doing the guard's job.
   *
   *  UNDER POOLING THIS COUNT IS AN EFFECTIVE SAMPLE SIZE, not a trial count: a class of exchangeable
   *  cards contributes one sample per held MEMBER per trial, so it routinely exceeds `trials`. That is
   *  the point -- it is the denominator the printed ratio was actually computed over, which is exactly
   *  what the gate has to read. */
  byCardCastable: Map<string, number[]>;
  /** Per card, per turn: P(the board could tap at least that card's mana value by then), on the same
   *  held denominator. Still not "castable" — see the colour ceiling. */
  byCard: Map<string, number[]>;
  /** Per card, per turn: THE SAMPLES THAT COUNTED. The denominator behind the two maps above, and
   *  the only thing that says whether they are worth printing. A commander is priced from the command
   *  zone and is held in every trial.
   *
   *  IT IS A SAMPLE COUNT, NOT A TRIAL COUNT, and the difference is pooling. A trial contributes one
   *  sample per HELD MEMBER of the card's exchangeable class, so a card sharing its pip pattern with
   *  thirteen others routinely reads well above `trials`. Read it as "how much evidence stands behind
   *  this cell", which is what every consumer wants and what `MIN_HELD_TRIALS` gates on -- never as
   *  "how many games had this card in hand". With `pooled: false` the two readings coincide again. */
  byCardHeld: Map<string, number[]>;
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
  // THE CHEAPEST NONLAND settles every mana-value restriction at once: mana that may be spent only at
  // value N or greater is worth its face in a deck holding nothing below N (roadmap O1).
  const cheapest = Math.min(Infinity, ...deck
    .filter((dc) => !/\bland\b/i.test(frontTypeLine(dc.card.typeLine, dc.card.layout)))
    .map((dc) => dc.card.manaValue ?? 0));
  const slots: DeckSlot[] = deck.map((dc) => {
    const isLand = /\bland\b/i.test(frontTypeLine(dc.card.typeLine, dc.card.layout));
    const text = dc.card.oracleText ?? "";
    // A land-fetch SPELL searches the library too, so it fixes colours and thins by the same fact.
    const fetches = isLandFetch(text);
    return {
      name: dc.card.name,
      manaValue: dc.card.manaValue ?? 0,
      typeLine: dc.card.typeLine ?? "",
      isLand,
      output: spendable(manaOutput(dc.card.oracleText), cheapest),
      everyLandType: isEveryLandType(dc.card.typeLine, dc.card.oracleText),
      colors: fetches ? fetchMask(text, printed) : colorMask(dc.card.producedMana),
      fetches,
      fetchTapped: fetches && FETCHES_TAPPED.test(text),
      ...(!isLand && TAP_REPLACEMENT.test(text) && BONUS_COLORLESS.test(text) ? { tapBonus: "colorless" as const } : {}),
      ...(!isLand && TAP_REPLACEMENT.test(text) && BONUS_CREATURE.test(text) ? { tapBonus: "creature" as const } : {}),
      ...(!isLand && landfallMana(text) > 0 ? { landfall: landfallMana(text) } : {}),
      ...(fetches && FETCH_UNTAPS.test(text) ? { fetchUntapsAt: FETCH_UNTAP_LANDS } : {}),
      // A SPLIT CARD'S JOINED COST IS NOT A COST ANYONE PAYS — see `split-cost.ts`. Identical to
      // `manaCost` for every other card, and `costKey` follows it so the memo cannot key two
      // different costs to one answer.
      cost: isLand ? null : parseCost(castableManaCost(dc.card)),
      costKey: castableManaCost(dc.card) ?? "",
      ...(isLand ? { land: classifyLand(dc.card) } : { accelerant: classifyAccelerant(dc) }),
    };
  });
  const nonlands = slots.filter((s) => !s.isLand);
  // AN EXTRA IS PRICED, AND IF IT MAKES MANA IT IS ALSO PLAYED. These rows used to be cost-only --
  // `accelerant: null`, `output: 1`, `colors: 0` -- which is why a mana-producing COMMANDER
  // contributed nothing to the board it is guaranteed to be on (roadmap O1). They now read the same
  // printed facts a library slot does; what stays different is `isExtra`, so the commander never
  // enters the `payableShare` denominator of a deck it is not in.
  const extras: DeckSlot[] = (opts.alsoPrice ?? []).map((dc) => {
    const text = dc.card.oracleText ?? "";
    return {
      name: dc.card.name,
      manaValue: dc.card.manaValue ?? 0,
      typeLine: dc.card.typeLine ?? "",
      isLand: false,
      output: spendable(manaOutput(text), cheapest),
      everyLandType: false,
      colors: colorMask(dc.card.producedMana),
      fetches: false,
      cost: parseCost(castableManaCost(dc.card)),
      costKey: castableManaCost(dc.card) ?? "",
      accelerant: classifyAccelerant(dc),
      ...(TAP_REPLACEMENT.test(text) && BONUS_COLORLESS.test(text) ? { tapBonus: "colorless" as const } : {}),
      ...(TAP_REPLACEMENT.test(text) && BONUS_CREATURE.test(text) ? { tapBonus: "creature" as const } : {}),
      ...(landfallMana(text) > 0 ? { landfall: landfallMana(text) } : {}),
      isExtra: true,
    };
  });
  const priced = [...nonlands, ...extras];
  // A PROBABILITY IS PER CARD, NOT PER COPY (roadmap N1). `byCardHits` keys on NAME, so a deck
  // running 30 Dragon's Approach accumulated 30 hits per trial-turn and printed 2,934%. The event
  // "this card is castable" is a property of the board and the COST, which every copy shares, so it
  // is counted on the first slot of each name and skipped on the rest. `affordable` below still
  // counts every copy, deliberately: that share really is 30 castable cards of 99.
  const seenName = new Set<string>();
  const countsForByCard = priced.map((s) => { const first = !seenName.has(s.name); seenName.add(s.name); return first; });

  // POOLED CONDITIONING. A non-accelerant nonland slot touches the trial trajectory in
  // exactly one place: its cost pips enter `demandPips` (the accelerant branch reads `a` first, the
  // land branches read `isLand`). So two such slots with the same pip multiset are EXCHANGEABLE --
  // swapping them maps shuffles bijectively and preserves the trajectory -- and the board law given
  // "held X by turn n" is identical for every member of the class. Every trial holding ANY member is
  // therefore a valid sample for EVERY member's conditional cell, weighted by how many members it
  // holds (linearity over members keeps the ratio exactly the per-member conditional probability).
  // An accelerant changes the board it is held in, so it stays its own class; an extra (commander)
  // is held in every trial and stays its own class too.
  const pooled = opts.pooled ?? true;
  const classOf = priced.map((s, i) => !pooled
    ? `U:${i}`
    : s.isExtra
      ? `X:${s.name}`
      : s.accelerant
        ? `A:${s.name}`
        : `P:${[...(s.cost?.pips ?? [])].sort((a, b) => a - b).join(",")}`);

  const manaAt: number[][] = Array.from({ length: turns }, () => [] as number[]);
  const payableShareAt: number[][] = Array.from({ length: turns }, () => [] as number[]);
  const byCardHits = new Map<string, number[]>();
  const byCardCastHits = new Map<string, number[]>();
  const heldHits = new Map<string, number[]>();
  for (const s of priced) {
    if (!byCardHits.has(s.name)) byCardHits.set(s.name, Array(turns).fill(0));
    if (!byCardCastHits.has(s.name)) byCardCastHits.set(s.name, Array(turns).fill(0));
    if (!heldHits.has(s.name)) heldHits.set(s.name, Array(turns).fill(0));
  }

  const forceTurn = opts.forceTurn ?? 0;
  // FORCED MODE shuffles only the prefix a short trial can consume: 7 + turn draws, plus at most one
  // library removal per fetch SLOT in the deck (each fires once) -- an exact bound, so the partial
  // Fisher-Yates prefix is a uniform permutation prefix and never reads unshuffled tail.
  const prefixK = opts.forceName !== undefined
    ? Math.min(slots.length, 7 + forceTurn + slots.filter((s) => s.fetches).length + 1)
    : slots.length;
  for (let t = 0; t < trials; t++) {
    const library = [...slots];
    if (prefixK >= library.length) {
      // Fisher-Yates against the seeded generator, so a run is reproducible card-for-card.
      for (let i = library.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [library[i], library[j]] = [library[j], library[i]];
      }
    } else {
      for (let i = 0; i < prefixK; i++) {
        const j = i + Math.floor(random() * (library.length - i));
        [library[i], library[j]] = [library[j], library[i]];
      }
    }
    if (opts.forceName !== undefined) {
      // Conditioning by construction: the other 98 cards stay a uniform shuffle whatever position
      // the forced card held, so moving it to a uniform slot among the first 7+turn IS the
      // conditional law of the shuffle given "drawn by turn" (minus the fetch-advancement sliver).
      const at = library.findIndex((s) => s.name === opts.forceName);
      const target = Math.floor(random() * (7 + forceTurn));
      const [x] = library.splice(at, 1);
      library.splice(target, 0, x);
    }
    const hand: DeckSlot[] = library.splice(0, 7);
    // EVERY CARD THIS TRIAL HAS SEEN, and it never forgets one (T18b). "Still in hand" is the wrong
    // condition and it inverted the answer on exactly the cards a deck is happiest to draw: rule 3
    // casts accelerants greedily, so `Sol Ring` had already LEFT the hand by the time the cell below
    // was scored and read as held in 5 trials of 2,000 -- not 8% of them, which is what a singleton
    // in an opening seven actually is. A zero-mana rock read 0 and would have printed 0%.
    const drawn = new Set<string>();
    for (const c of hand) drawn.add(c.name);
    // A COMMANDER THAT MAKES MANA STARTS IN HAND, because the command zone is not the library: it is
    // available every game with no draw, which makes it the most reliable accelerant a deck has, and
    // rule 3 was never able to cast it (roadmap O1). 6 of the 71 decks have one and every one was
    // priced at zero. It is NOT shuffled in -- that would both dilute the draw and pretend it can be
    // drawn (CR 903.6, the rule `alsoPrice` already exists for) -- and it keeps its own priced row.
    for (const e of extras) if (e.accelerant) hand.push(e);
    const lands: OnBoardLand[] = [];
    const rocks: { turn: number; mana: number; colors: number }[] = [];   // the turn each landed, what it taps for, and in which colours
    const dorks: { turn: number; mana: number; colors: number }[] = [];
    // A PER-SOURCE BONUS, kept beside the sources rather than among them: it makes OTHER permanents
    // produce more, so it has no mana of its own to add (roadmap O2).
    const bonuses: { turn: number; need: "colorless" | "creature"; colors: number }[] = [];
    // Landfall mana is per EVENT, not per turn: it pays for each land that entered THIS turn, which
    // is the land drop and anything a fetch put down beside it.
    const landfalls: { turn: number; mana: number; colors: number }[] = [];

    for (let turn = 1; turn <= turns; turn++) {
      // Rule 1: one card per turn, INCLUDING turn 1. On the play there is no turn-1 draw; modelling
      // the draw is the flattering direction by one card and is stated rather than hidden.
      const pulled = library.shift();
      if (pulled) { hand.push(pulled); drawn.add(pulled.name); }

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
      // COLOUR IS ASKED OF THE HAND BEFORE THE SHUFFLE IS. Among the lands that enter untapped and
      // whose own gate is met, the one that covers the most colours the hand wants and the board
      // cannot make wins; ties keep hand order, so a deck with no colour tension is unchanged.
      const untappedIdx: number[] = [];
      for (let i = 0; i < hand.length; i++) {
        if (live(hand[i]) && hand[i].land !== undefined && !entersTapped(hand[i].land!, board)) untappedIdx.push(i);
      }
      let boardColors = 0;
      for (const l of lands) boardColors |= l.colors;
      const demandPips: number[] = [];
      for (const c of hand) if (!c.isLand && c.cost) demandPips.push(...c.cost.pips);
      const idx = [
        untappedIdx.length > 0
          ? untappedIdx[pickLand(untappedIdx.map((i) => hand[i]), boardColors, demandPips)]
          : -1,
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
        // Tracked so a per-source bonus can count what it actually reads: a creature bonus pays for
        // dorks and not for lands, a colourless one for anything that taps for {C}.
        const isCreature: boolean[] = [];
        const push = (mana: number, colors: number, creature: boolean): void => { out.push({ mana, colors }); isCreature.push(creature); };
        for (const l of lands) {
          if (l.enteredTapped && l.enteredTurn === turn) continue;
          const m = produced(l.output, lands);
          if (m > 0) push(m, l.colors, false);
        }
        for (const r of rocks) if (r.turn <= turn) push(r.mana, r.colors, false);
        for (const d of dorks) if (d.turn < turn) push(d.mana, d.colors, true);
        // A TAP-REPLACEMENT PAYS PER SOURCE, NOT PER MANA: Forsaken Monument adds one {C} for every
        // permanent TAPPED for {C}, so a source making two mana off one tap is still one trigger.
        // Counted after the sources exist and never against another bonus, which is what keeps two
        // Monuments from reading each other.
        // PER LAND ENTERING THIS TURN -- the drop plus whatever a fetch found.
        const entered = lands.filter((l) => l.enteredTurn === turn).length;
        for (const f of landfalls) if (f.turn <= turn && entered > 0) out.push({ mana: f.mana * entered, colors: f.colors });
        const base = out.length;
        for (const b of bonuses) {
          if (b.turn > turn) continue;
          let n = 0;
          for (let i = 0; i < base; i++) {
            if (b.need === "creature" ? isCreature[i] : (out[i].colors & COLORLESS) !== 0) n++;
          }
          if (n > 0) out.push({ mana: n, colors: b.colors });
        }
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
        // A PER-SOURCE BONUS BRINGS NO MANA OF ITS OWN, so it goes to `bonuses` INSTEAD of the source
        // lists -- adding it to both would pay it once for existing and once per source.
        if (cast.landfall !== undefined) {
          landfalls.push({ turn: turn + 1, mana: cast.landfall, colors: cast.colors });
        }
        else if (cast.tapBonus !== undefined) {
          bonuses.push({ turn: a.kind === "rock" ? turn : turn + 1, need: cast.tapBonus, colors: cast.colors });
        }
        else if (a.kind === "rock") { rocks.push({ turn, mana, colors: cast.colors }); pool += mana; }
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
      // FORCED MODE: only the forced card's cells are meaningful (and only at forceTurn, which is
      // the one cell the caller reads); everything else is skipped for speed.
      if (opts.forceName !== undefined) {
        for (let i = 0; i < priced.length; i++) {
          const s = priced[i];
          if (!countsForByCard[i] || s.name !== opts.forceName || !drawn.has(s.name)) continue;
          heldHits.get(s.name)![turn - 1]++;
          if ((s.cost?.total ?? s.manaValue) > made) break;
          byCardHits.get(s.name)![turn - 1]++;
          if (s.cost !== null && payable(untapped, s.cost)) byCardCastHits.get(s.name)![turn - 1]++;
          break;
        }
        payableShareAt[turn - 1].push(0);
        continue;
      }
      // Pass 1: `affordable` (every copy, as before) and the held-member count per class.
      const heldPerClass = new Map<string, number>();
      for (let i = 0; i < priced.length; i++) {
        const s = priced[i];
        if (!s.isExtra && (s.cost?.total ?? s.manaValue) <= made) affordable++;
        if (countsForByCard[i] && (s.isExtra === true || drawn.has(s.name))) {
          heldPerClass.set(classOf[i], (heldPerClass.get(classOf[i]) ?? 0) + 1);
        }
      }
      // Pass 2: pooled cells. Each trial contributes |held members of the class| samples of the SAME
      // board to every member's cell -- denominator and numerators alike -- so the ratio stays the
      // per-member conditional probability. A class with no held member contributes nothing, and its
      // `payable` is never computed.
      for (let i = 0; i < priced.length; i++) {
        if (!countsForByCard[i]) continue;
        const s = priced[i];
        const w = heldPerClass.get(classOf[i]) ?? 0;
        if (w === 0) continue;
        heldHits.get(s.name)![turn - 1] += w;
        if ((s.cost?.total ?? s.manaValue) > made) continue;
        byCardHits.get(s.name)![turn - 1] += w;
        if (s.cost === null) continue;
        let ok = castableByCost.get(s.costKey);
        if (ok === undefined) { ok = payable(untapped, s.cost); castableByCost.set(s.costKey, ok); }
        if (ok) byCardCastHits.get(s.name)![turn - 1] += w;
      }
      payableShareAt[turn - 1].push(nonlands.length > 0 ? affordable / nonlands.length : 0);
    }
  }

  // OVER THE TRIALS THAT HELD THE CARD, never over every trial. A zero denominator reads 0 and
  // `castability.ts` refuses it on the count rather than on the value.
  const rate = (name: string, hits: readonly number[]): number[] =>
    hits.map((h, i) => { const d = heldHits.get(name)![i]; return d === 0 ? 0 : h / d; });
  const byCard = new Map<string, number[]>();
  for (const [name, hits] of byCardHits) byCard.set(name, rate(name, hits));
  const byCardCastable = new Map<string, number[]>();
  for (const [name, hits] of byCardCastHits) byCardCastable.set(name, rate(name, hits));
  return { trials, turns, manaAt, payableShareAt, byCard, byCardCastable, byCardHeld: heldHits };
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

/** Trials the REPORT runs at, against the 20k the bin uses. TWO THOUSAND, RAISED TO TEN THOUSAND
 *  (T18b), AND BACK TO TWO ONCE THE SAMPLES STOPPED BEING WASTED.
 *
 *  THE DECK-LEVEL FIGURE WAS ALWAYS FINE AT 2,000, and this paragraph is the original measurement,
 *  kept because it is the one that governs the availability headline again. That figure is CHOSEN
 *  AGAINST THE WIDTH OF THE THING IT SITS INSIDE, which is the only defensible way to pick a Monte
 *  Carlo sample size: the POLICY interval it is reported inside has a median width of 7.0pp, and the
 *  sampling noise at 2,000 trials is well under that -- **SD 0.83-1.22pp (median 1.03) across 10
 *  decks x 20 seeds, with the worst single excursion from the 20,000-trial answer at 3.6pp**
 *  (roadmap N5, re-measured 2026-08-26). An earlier version of this comment claimed "within about
 *  0.5pp", which was optimistic by 2x on the SD and 7x on the tail; the CONCLUSION survived the
 *  correction and the sentence did not. A figure that prints as a whole percent inside a 7pp band can
 *  carry a 1pp SE. Measured cost: about 24ms per policy arm on a 99-card deck.
 *
 *  WHAT T18b ACTUALLY NEEDED 10,000 FOR was the PER-CARD cell, which is conditional on having DRAWN
 *  the card: a singleton is drawn by turn N in roughly (6 + N)/99 of trials, so at 2,000 REAL trials
 *  a one-drop's cell rested on about 160 shuffles -- +-9pp at 95%, under a row printing a policy band
 *  one point wide. Running five times as many games is the brute-force answer to that. It throws away
 *  ~90% of every trial and buys the rest back with wall clock.
 *
 *  POOLING ANSWERS IT INSTEAD. `simulate` shares each trial across the class of cards that trial
 *  cannot tell apart, so the same 2,000 games carry a median 28x the samples per cell. MEASURED with
 *  `bin/castability-conditional.ts` over the 71 calibration decks, 4,476 priced cells -- thinnest
 *  cell, by sampler:
 *
 *    real @ 2,000     120      every cell under `MIN_HELD_TRIALS`
 *    real @ 10,000    732      no cell under it, at 5x the work
 *    pooled @ 2,000   601      no cell under it, because the top-up is floored there
 *
 *  MEASURED COST, `packages/cli` end to end, best of three: gisa 1.41s -> 1.05s, samut 1.56s ->
 *  1.22s, inalla 1.54s -> 1.16s.
 *
 *  MEASURED PRICE, and it is paid by the deck-level headline, which pooling does NOT accelerate --
 *  `manaAt` is one sample per trial whatever the classes do. Across the 71 decks the headline policy
 *  gap moves |2k - 10k| by median 0.38pp, p90 1.76pp, max 2.84pp, inside the tolerance the first
 *  paragraph states. FOUR of the 71 change how they RENDER, because their gap sits within a point of
 *  `POLICY_COLLAPSE` and crossing it swaps a band for one number -- two decks each way, so it is
 *  noise and not a direction. Raising this constant back to 10,000 is free and costs only wall
 *  clock. */
export const REPORT_TRIALS = 2_000;

/** HOW MANY SAMPLES MUST STAND BEHIND A CARD'S CELL before its percentage is worth printing.
 *
 *  DERIVED, NOT PICKED. `POLICY_COLLAPSE` is this project's own statement of the smallest gap between
 *  two probabilities that means anything -- 8pp, below which two figures "say the same thing twice".
 *  Sampling noise has to sit under that or the report is reading its own jitter, so the floor is the
 *  sample size whose 95% interval is no wider than the collapse threshold at the worst case p = 0.5:
 *  `2 * 1.96 * sqrt(0.25 / n) <= POLICY_COLLAPSE`, i.e. `n >= (1.96 / POLICY_COLLAPSE) ** 2`.
 *
 *  IT LIVES HERE, NEXT TO THE TRIAL COUNT IT IS IN TENSION WITH, and `castability.ts` imports it to
 *  do the refusing. Both directions are load-bearing: the gate refuses a cell the sampler left thin,
 *  and `manaModel`'s forced top-up below is floored at this number so the sampler never leaves one. */
export const MIN_HELD_TRIALS = Math.ceil((1.96 / POLICY_COLLAPSE) ** 2);

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
  /** Trials the two rates above were computed over: the ones where the card was in hand (T18b).
   *  A singleton reaches roughly (6 + turn)/99 of them, so this is a couple of hundred out of two
   *  thousand and `castability.ts` refuses a card whose count is thinner than that. */
  held: number[];
}

export interface ManaModel {
  availability: ManaAvailability;
  /** By card name, for every nonland in the library plus everything in `alsoPrice`. */
  curves: Map<string, CastCurve>;
  turns: number;
  /** Median mana the board could TAP, per turn, indexed by `turn - 1` and running the full `turns`
   *  rather than the table's eight rows.
   *
   *  IT IS THE MEDIAN AND NOT AN INTERVAL BECAUSE THE MEDIAN IS POLICY-INSENSITIVE -- measured, and
   *  the same finding `ManaAvailabilityRow.mana` is built on: the two policy arms agree on the
   *  median at every turn while the tail moves by up to 27.6pp. Its one consumer is
   *  `pressure.ts`'s mana budget, which needs a number rather than a band. */
  manaMedian: number[];
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
      // Both arms shuffle from the same seed, so they hold the card in the same trials; one count
      // describes the pair.
      held: greedy.byCardHeld.get(name) ?? [],
    });
  }
  // FORCED TOP-UP for thin classes. A singleton class -- an accelerant, or the only card
  // with its pip pattern -- gains nothing from pooling, so its printed cell is topped up with
  // forced-conditioning trials: the card placed uniformly among the first 7+turn library slots,
  // simulated only to its printed turn, only its own cell counted. Combined with the base estimate
  // by sample count, per arm.
  // VARIANCE-TARGETED: top a cell up only to the sample size its own binomial variance asks for.
  // A rock sitting at 99% castable needs ~30 samples for a 2pp SE; a 50% cell needs ~600. The
  // base estimate's own noise is absorbed by widening p toward 0.5 by two of its standard errors.
  const SE_TARGET = 0.016;
  const copies = new Map<string, number>();
  for (const dc of deck) copies.set(dc.card.name, (copies.get(dc.card.name) ?? 0) + 1);
  let forcedRuns = 0;
  const seenTop = new Set<string>();
  for (const dc of deck) {
    const name = dc.card.name;
    if (seenTop.has(name)) continue;
    seenTop.add(name);
    if ((copies.get(name) ?? 0) > 1) continue; // multi-copy names are never thin
    if (/\bland\b/i.test(frontTypeLine(dc.card.typeLine, dc.card.layout))) continue;
    const turn = Math.max(1, Math.round(dc.card.manaValue ?? 0));
    if (turn > turns) continue;
    const curve = curves.get(name);
    if (!curve) continue;
    const baseHeld = curve.held[turn - 1] ?? 0;
    // The p whose variance governs the printed cell: the edge of either band closest to one half,
    // widened toward 0.5 by 2 SE of the base estimate itself so a noisy 0.99 is not trusted.
    const edges = baseHeld < 50 ? [0.5] : [
      curve.castable[turn - 1]?.low ?? 0.5, curve.castable[turn - 1]?.high ?? 0.5,
      curve.mana[turn - 1]?.low ?? 0.5, curve.mana[turn - 1]?.high ?? 0.5,
    ];
    // dist = |p - 0.5| after widening each edge toward 0.5 by 2 SE; the smallest distance is the
    // most mid-range (highest-variance) edge, and that variance sizes the sample the cell needs.
    const dist = Math.min(...edges.map((p) => {
      const se = Math.sqrt(Math.max(p * (1 - p), 0.01) / Math.max(baseHeld, 1));
      return Math.max(0, Math.abs(p - 0.5) - 2 * se);
    }));
    // FLOORED AT `MIN_HELD_TRIALS`, which is what keeps the two halves of this file honest with each
    // other: the variance target above sizes a cell by its own p, and a cell sitting at 99% really
    // does need fewer samples than one at 50% -- but `castability.ts` gates on a FLAT count, so a
    // well-measured extreme cell left at 300 would be refused for looking thin. Top every cell to the
    // gate and the gate never fires on the sampler's own arithmetic.
    const need = Math.max(MIN_HELD_TRIALS, Math.ceil((0.25 - dist * dist) / (SE_TARGET * SE_TARGET)));
    const F = Math.min(2000, Math.max(0, need - baseHeld));
    if (F === 0) continue;
    forcedRuns++;
    const fseed = seed + 7919 * forcedRuns;
    const fg = simulate(deck, { trials: F, turns: turn, seed: fseed, alsoPrice, forceName: name, forceTurn: turn });
    const fh = simulate(deck, { trials: F, turns: turn, seed: fseed, holdUp: 2, alsoPrice, forceName: name, forceTurn: turn });
    const comb = (base: SimulateResult, forced: SimulateResult, map: "byCardCastable" | "byCard"): number => {
      const bHeld = base.byCardHeld.get(name)![turn - 1];
      const bHits = Math.round((base[map].get(name)![turn - 1] ?? 0) * bHeld);
      const fHeld = forced.byCardHeld.get(name)![turn - 1];
      const fHits = Math.round((forced[map].get(name)![turn - 1] ?? 0) * fHeld);
      return (bHits + fHits) / (bHeld + fHeld);
    };
    const band2 = (a: number, b: number): { low: number; high: number } =>
      ({ low: Math.min(a, b), high: Math.max(a, b) });
    curve.castable[turn - 1] = band2(comb(greedy, fg, "byCardCastable"), comb(held, fh, "byCardCastable"));
    curve.mana[turn - 1] = band2(comb(greedy, fg, "byCard"), comb(held, fh, "byCard"));
    curve.held[turn - 1] = greedy.byCardHeld.get(name)![turn - 1] + fg.byCardHeld.get(name)![turn - 1];
  }
  return {
    turns,
    curves,
    manaMedian: greedy.manaAt.map((col) => quantiles(col).median),
    availability: {
      trials,
      accelerants: deck.map(classifyAccelerant).filter((a) => a !== null).length,
      rows,
      headline: { mana: 6, turn: 6, low: Math.min(lo, hi), high: Math.max(lo, hi) },
    },
  };
}
