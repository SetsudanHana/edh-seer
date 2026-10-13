/** WHICH OF A CARD'S DERIVED MANA LINES ARE COLOUR SOURCES (#1169, task 2a). Derive reads a card's mana production ONCE
 *  (`CardTags.manaLines`, `staticFixer`, `landFetch`); this module is the matcher's only question of it: "does this line
 *  make mana the deck's spells can use, repeatably, without consuming anything?" The colour audit, the mana base, the land
 *  score and the swap suggestions all ask it here, so they cannot disagree about a card (they did: Gisa's black was 38 by
 *  one and 33 by the other). No oracle text is read and Scryfall's `producedMana` is not consulted.
 *
 *  A COLOUR SOURCE (owner, 2026-10-08 and 2026-10-10) is a repeatable tap or static production you control without
 *  consuming a resource. Treasure makers, sacrifice outlets and counter-fuelled mana are ramp; trigger mana (Birgi) is ramp;
 *  restricted mana ("spend only ...", Smokebraider) is never a source; a GATED line (Tainted Peak's B/R needs a Swamp) is a source
 *  only where the DECK meets its gate (owner 2026-10-13: the audit follows the gate check, `gate.ts`) and, in a clock, by the turn it is met.
 *  `isColourSource` is the schema's own predicate, stated on `ManaLine`: it asks for no gate, and the deck-aware reading is `colourSourceLine`.
 *
 *  COST AGAINST PRODUCTION (owner, 2026-10-08, #1114): a costed line is FIXING only when it produces at least its mana cost
 *  plus the source's own tap. Cascade Bluffs ("{U/R}, {T}: Add {U}{U}, {U}{R}, or {R}{R}") pays 1 and makes 2: a full U and
 *  R source. Cascading Cataracts ("{5}, {T}: Add five mana in any combination of colors") and Prismatic Lens ("{1}, {T}: Add
 *  one mana of any color") make less than they cost: colourless only (`makesAnyMana` still holds, `colourSourceColours` is
 *  empty). `ManaLine.net` is the production less `cost.mana`, so the rule is `net >= 1`. A scaling amount ("{B} for each
 *  Swamp") cannot be judged from the line and is not struck, as before. */
import type { ManaLine } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { gateMet, gateMetBy } from "./gate.js";
import { countsAsLand, parseTypeLine } from "./typeline.js";

export const WUBRG = ["W", "U", "B", "R", "G"] as const;
const BASIC_COLOUR: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };

/** The colours of the deck's commanders: what "your commander's colour identity" resolves to. `null` is unknown (a deck with no
 *  commander named, or commanders carrying no identity field), and an unknown identity restricts nothing. */
export type DeckIdentity = ReadonlySet<string> | null;

export function deckIdentity(deck: readonly DeckCard[], commanderNames: readonly string[]): DeckIdentity {
  if (commanderNames.length === 0) return null;
  const names = new Set(commanderNames);
  const found = deck.filter((dc) => names.has(dc.card.name) && dc.card.colorIdentity !== undefined);
  return found.length === 0 ? null : new Set(found.flatMap((dc) => dc.card.colorIdentity!));
}

/** COST PIECES THAT CONSUME NOTHING: exerting a creature (it skips an untap, Arena of Glory, Oasis Ritualist), untapping a permanent
 *  (Benthic Explorers) and milling yourself (Millikin: the card is not a resource the deck plays). Every other entry in `cost.other` is a
 *  consumed resource: energy, a discard, collect evidence, forage, an exile from a graveyard (owner rulings 2026-10-10 and 2026-10-11).
 *  The list is the whole of what the corpus holds. */
const NON_CONSUMING_COST = /^(?:exert|untap|mill)\b/i;

/** A LOYALTY COST as derive stores it in `cost.other`: "+2", "0", "−1" (U+2212, the printed minus). "−X" is none: no loyalty can be compared with it. */
const LOYALTY_COST = /^(?:\+\d+|0|[\u2212-]\d+)$/;
/** THE LINE IS A PLANESWALKER'S LOYALTY ABILITY, and it pays nothing else. */
export const isLoyaltyAbility = (line: ManaLine): boolean => line.cost.other.length === 1 && LOYALTY_COST.test(line.cost.other[0]!);

/** HOW MANY TURNS A LOYALTY ABILITY CAN BE USED from the walker's STARTING loyalty (`ManaLine.startLoyalty`), counting the turn it is cast: Infinity for a
 *  "+N" or "0" (CR 606.3: once per turn at sorcery timing, and nothing is taken from the loyalty), floor(loyalty / cost) for a "−N" (CR 606.6: it can't be
 *  activated without that many counters; a walker enters with its printed loyalty, CR 306.5b), 0 when a negative cost's loyalty is not known or does not cover it.
 *  Owner 2026-10-13: a loyalty mana or land-fetch ability counts iff the walker can activate it the turn it is cast, i.e. at least 1.
 *  CEILING: only this one ability is counted. A walker that also gains loyalty with its other abilities (a "+1" beside the "−1") could use the minus
 *  ability for longer; the model does not play those. */
export function loyaltyActivations(line: ManaLine): number {
  if (!isLoyaltyAbility(line)) return Infinity;
  const cost = Number(line.cost.other[0]!.replace("\u2212", "-"));
  if (cost >= 0) return Infinity;
  return line.startLoyalty === undefined ? 0 : Math.floor(line.startLoyalty / -cost);
}
/** A LOYALTY ABILITY THE WALKER CAN ACTIVATE THE TURN IT IS CAST. */
export const usableLoyalty = (line: ManaLine): boolean => isLoyaltyAbility(line) && loyaltyActivations(line) >= 1;

/** A COST THE LINE'S HOLDER CANNOT PAY FROM NOTHING: sacrificing another permanent, a counter removed or put, another permanent tapped (Springleaf
 *  Drum), or any `cost.other` piece off the allow-list above (a loyalty cost is on it, of either sign: whether the loyalty covers a "−N" is `usableLoyalty`'s
 *  question, and the colour audit never asks, as a loyalty ability is no tap) -- a consumed resource (energy, a discard, forage, an exile from a graveyard). The
 *  colour audit and the goldfish both refuse a line paid this way: the first because the mana is not a source you control, the second because it
 *  models no board to pay from. */
export const paidWithResource = (line: ManaLine): boolean =>
  line.cost.sacrificeOther || line.cost.counters !== null || line.cost.tapOther || !line.cost.other.every((o) => NON_CONSUMING_COST.test(o) || LOYALTY_COST.test(o));

/** The shape of a colour source -- everything `isColourSource` asks except that the production could be read, and the gate: the caller says whether it holds. */
const sourceShaped = (line: ManaLine, gateHolds = false): boolean =>
  (line.source === "activated" || line.source === "static-grant")
  && (gateHolds || line.gate === null) && line.restriction === null
  && !line.cost.sacrificeSelf && !paidWithResource(line)
  // A LOYALTY COST IS NO RESOURCE (`paidWithResource`), but a walker's ability is a source only if it can be activated the turn the walker is cast (owner 2026-10-13:
  // "the loyalty test applies to colour sources too"). Nissa, Worldwaker's -7 from loyalty 3 is not a Forest source; that is correct, and was only counted before
  // because the loyalty cost was never compared with the loyalty.
  && (!isLoyaltyAbility(line) || usableLoyalty(line))
  && (line.cost.tap || line.source === "static-grant");

/** THE SCHEMA'S COLOUR-SOURCE RULE (`ManaLine` in tagger/schema.ts), plus the source label it implies: an activated ability the
 *  card itself taps, or the line a static ability grants. A trigger, an aura trigger, a token maker, a one-shot spell and a fetch
 *  are never one, whatever their cost says. A non-empty `cost.other` is a consumed resource unless it is on the list above.
 *  A `grantee` line (Katilda: the grantee's own colours) is not one: the card grants the ability and does not tap for it.
 *  A GATED line (Tainted Peak's B/R needs a Swamp, Honored Hierarch's needs renown) is none here: this predicate is deck-free. Whether the deck meets the gate is `colourSourceLine`. */
export const isColourSource = (line: ManaLine): boolean => sourceShaped(line) && !line.unread && line.anyColour !== "grantee";

/** THE COLOUR-SOURCE RULE FOR A LINE IN A DECK (owner 2026-10-13: the colour audit follows the gate check, one answer for the audit and castability). An ungated line is one by
 *  `isColourSource`; a gated line is one when the deck meets its gate -- over the deck (`gateMet`, the median clock) with no `turn`, or by `turn` (`gateMetBy`, the closed form of the
 *  goldfish's timing), the same answer the goldfish gives. With no deck a gated line is none, as before; a gate no decklist settles (renown, speed, counters) is none, always.
 *  CEILING: the deck is judged whole, so a gated Verge in a deck with two basics of its type counts only when `gate.ts` says the type is likely out; the colour audit's clock reads that likelihood
 *  per turn, the flat count (`supplied`, the mana base) reads it at the median clock. */
export function colourSourceLine(line: ManaLine, deck?: readonly DeckCard[], turn?: number, holderIsLand = false): boolean {
  if (line.gate === null) return isColourSource(line);
  const holds = deck !== undefined && (turn === undefined ? gateMet(line, deck) : gateMetBy(line.gate, deck, turn, holderIsLand));
  return holds && sourceShaped(line, true) && !line.unread && line.anyColour !== "grantee";
}

/** THE CARD HAS A GATED LINE THAT WOULD BE A COLOUR SOURCE IF ITS GATE HELD: what a clock must re-ask turn by turn. */
export const hasGatedColourLine = (dc: DeckCard): boolean => cardLines(dc).some((l) => l.gate !== null && sourceShaped(l, true) && !l.unread && l.anyColour !== "grantee");

/** THE NAMES OF CARDS WITH A LINE THAT WOULD BE A COLOUR SOURCE BUT WHOSE PRODUCTION DERIVE COULD NOT READ ("choose a color of a permanent
 *  you control", Meteor Crater; "the type a land could produce" with a counter clause, Incubation Druid). They count as NO colour --
 *  never a silent zero: the colour audit lists them (`unreadSources`) so the report can say its count may be short.
 *  CEILING: counted as none, not guessed; 20 mana lines in the corpus are unread (research/mana/unread.mts, 2026-10-11, DERIVE_VERSION 301), most of them not mana at all. */
export function unreadSourceNames(cards: readonly DeckCard[]): string[] {
  return [...new Set(cards.filter((dc) => cardLines(dc).some((l) => l.unread && sourceShaped(l))).map((dc) => dc.card.name))].sort();
}

/** THE COST RULE: the line makes at least what it costs plus its tap.
 *  CEILING: a SCALING amount ("{B} for each Swamp", Cabal Coffers, Gaea's Cradle) skips the rule -- its amount cannot be judged from the
 *  line, so it is credited; Baldur's Gate ({2},{T}: X mana of one colour, X = other Gates) is the edge. */
export const paysItsWay = (line: ManaLine): boolean => line.amount.scales !== null || line.net >= 1;

/** THE FACES WHOSE LINES COUNT. A face node is its own face. A whole card counts its front, and its other face only when that face can be
 *  played from the deck: a modal DFC's back (a land you play), an Adventure's or a prepare card's spell half and a split card's second half
 *  (Rampant Growth on Studious First-Year, Seasonal Ritual on Rosethorn Acolyte, which you cast). A transform or flip card's back is never a
 *  source from the deck (`transformsIntoLand`, owner 2026-10-10, #1174: things that transform are not ramp) -- the same allow-list of
 *  FRONT-FACE-ONLY layouts `goldfish.ts` keeps for the type line, never a reject-list of the playable ones. */
const FRONT_FACE_ONLY = new Set(["transform", "flip"]);
const faceCounts = (dc: DeckCard, face: 0 | 1, nonLandBacks = false): boolean => {
  if (dc.face !== undefined) return dc.face === face;
  if (face === 0) return true;
  const layout = dc.card.layout ?? "";
  if (!FRONT_FACE_ONLY.has(layout)) return true;
  // The #1174 ruling is about a back that is a LAND (Treasure Map // Treasure Cove). A consumer that prices a back which is not (Ashling, Rimebound's
  // phase trigger: the goldfish's O1 model of a mana commander) asks for it.
  return nonLandBacks && !/\bland\b/i.test((dc.card.typeLine ?? "").split(" // ")[1] ?? "");
};

/** Every derived line of the card that is in play from the deck, a land's or not. `nonLandBacks`: also the lines of a transform or flip card's
 *  back when that back is not a land (only the goldfish asks, to keep pricing Ashling, Rimebound's trigger as it always has). */
export const cardLines = (dc: DeckCard, nonLandBacks = false): ManaLine[] => (dc.tags?.manaLines ?? []).filter((l) => faceCounts(dc, l.face, nonLandBacks));

/** A BASIC LAND TYPE IS A MANA ABILITY (CR 305.6), printed only as reminder text, which derive does not read: a land card with
 *  Plains, Island, Swamp, Mountain or Forest in its types taps for that colour whatever its text box says. Read off the type
 *  line of the faces that count. Also a land that makes EVERY land a basic type (Urborg, Yavimaya, Cradle of Growth): it is one of
 *  the lands, so it has the type itself (CR 305.7), read from the derived `staticFixer`. */
function intrinsicColours(dc: DeckCard): string[] {
  const out = new Set<string>();
  const faces = (dc.card.typeLine ?? "").split(" // ");
  faces.forEach((typeLine, i) => {
    if (!faceCounts(dc, (i === 0 ? 0 : 1) as 0 | 1)) return;
    const p = parseTypeLine(typeLine);
    if (!p.types.includes("land")) return;
    for (const t of p.subtypes) if (BASIC_COLOUR[t]) out.add(BASIC_COLOUR[t]!);
  });
  const fixer = dc.tags?.staticFixer;
  if (fixer?.covers === "lands" && /\bland\b/i.test(faces[0] ?? "")) for (const c of fixer.colours) out.add(c);
  return [...out];
}

/** HOW A LINE THAT CHOOSES A COLOUR RESOLVES (`ManaAnyColour`):
 *  - `any` is every colour the commander's identity allows; `identity` is the identity itself. With no identity known, all five.
 *  - `among` is bounded by what you control or have exiled and is counted as the identity (CEILING, in the switch).
 *  - `chosen`, `opponent-lands`, `lands-you-could` are bounded by something that is not on the card. `five` keeps what the colour
 *    audit and the mana base always did with them (Scryfall listed all five: Exotic Orchard, Reflecting Pool, Caged Sun); `none`
 *    keeps what the land score did (the colours are conditional, so the land is never "upgraded" or cut for them). `no-among` is the
 *    audit's count except that `among` (bounded by the board: Chrome Mox, Mox Amber) makes no claim: the rock swaps. */
export type BoundedColours = "five" | "none" | "no-among";

// CEILING: a bounded colour that is not the identity counts as FIVE for the audit and the mana base (what Scryfall listed: Exotic Orchard,
// Reflecting Pool, Caged Sun) and as NONE for the land swaps; neither is the colours the board really offers.
export function lineColours(line: ManaLine, identity: DeckIdentity, bounded: BoundedColours): string[] {
  const out = new Set(line.colours);
  switch (line.anyColour) {
    case "any": for (const c of WUBRG) if (!identity || identity.has(c)) out.add(c); break;
    // CEILING: `among` ("any color among legendary permanents you control", Chrome Mox's imprint) is bounded by what is on the board or
    // exiled, which this approximates by the commander's identity: the colours a deck can have. A Mox Amber with no legendary on the
    // battlefield makes nothing; here it makes the deck's colours.
    case "identity": for (const c of WUBRG) if (!identity || identity.has(c)) out.add(c); break;
    case "among": if (bounded === "five") for (const c of WUBRG) if (!identity || identity.has(c)) out.add(c); break;
    // `grantee` ("{T}: Add one mana of any of this creature's colors", Katilda): the colours are each GRANTEE's own, neither the deck's nor
    // the card's. CEILING: the grantees are each their own source and are not read, so the line credits no colour.
    case "grantee": break;
    case "chosen": case "opponent-lands": case "lands-you-could": if (bounded !== "none") for (const c of WUBRG) out.add(c); break;
    case null: break;
  }
  return WUBRG.filter((c) => out.has(c));
}

// CEILING: a line derive could not read (`unread`) is not a colour source -- it counts as none, and `unreadSourceNames` lists the cards.
/** THE COLOURS A CARD IS A COLOUR SOURCE OF, by its own tap or static production: its colour-source lines that pay their way, a
 *  land's intrinsic basic types. Given the `deck` it is in, a gated line the deck meets counts too (`colourSourceLine`), by `turn` when one is named. Empty for a card with no derived tags: it contributes nothing, and `coverage.ts` already lists it among the underived cards. A fetch is
 *  NOT counted here: what it finds is the deck's to say (`colour-sources.ts`). */
export function colourSourceColours(dc: DeckCard, identity: DeckIdentity = null, bounded: BoundedColours = "five", deck?: readonly DeckCard[], turn?: number): string[] {
  const out = new Set<string>(intrinsicColours(dc));
  const land = countsAsLand(dc.card);
  for (const l of cardLines(dc)) if (colourSourceLine(l, deck, turn, land) && paysItsWay(l)) for (const c of lineColours(l, identity, bounded)) out.add(c);
  return WUBRG.filter((c) => out.has(c));
}

/** EVERY MANA TYPE THE CARD'S OWN LINES CAN ADD, in WUBRG order and then `C` (#1169 task 2b-2): what Scryfall's `produced_mana` was meant to say, read from
 *  the derived lines instead. NOT the colour-source question (`colourSourceColours`: a repeatable tap/static production you control) but the broader "what mana
 *  does this card put in front of you": a ritual's colour, trigger mana (Birgi's {R}), an Aura's extra mana (Wild Growth's {G}), restricted and gated lines
 *  all count, so a card keeps the type it adds. What it does NOT count: a Treasure maker or any token maker (the TOKEN makes mana, later, for a sacrifice:
 *  Pitiless Plunderer lists all five colours on Scryfall and adds none), a land fetch (what it finds is the deck's to say, `colour-sources.ts`), a line derive
 *  could not read, and a `grantee` line (the grantees' own colours). A bounded `anyColour` (`chosen`, `among`, ...) counts as the five it can be, as the
 *  colour audit's "five" reading; `any` and `identity` are unbounded here (no commander is known to a card).
 *  CEILING: CARD-LEVEL, with the faces `cardLines` counts: a modal DFC's land back counts, a transform card's back does not (`FRONT_FACE_ONLY`). */
export function producedManaTypes(dc: DeckCard): string[] {
  const out = new Set<string>(intrinsicColours(dc));
  for (const l of cardLines(dc)) {
    if (l.source === "token-maker" || l.source === "fetch" || l.unread) continue;
    for (const c of lineColours(l, null, "five")) out.add(c);
    if (l.colourless > 0) out.add("C");
  }
  return [...WUBRG.filter((c) => out.has(c)), ...(out.has("C") ? ["C"] : [])];
}

/** DOES THE CARD ITSELF MAKE MANA you can use on demand, of any colour or none? A costed line that makes less than it costs still
 *  does (colourless, by the ruling). A plain fetch land does not: it makes mana only through what it finds. */
export function makesAnyMana(dc: DeckCard, deck?: readonly DeckCard[], turn?: number): boolean {
  const land = countsAsLand(dc.card);
  return intrinsicColours(dc).length > 0 || cardLines(dc).some((l) => colourSourceLine(l, deck, turn, land));
}

/** A LAND-FETCH THAT COUNTS AS A SOURCE OF WHAT IT FINDS (owner, 2026-10-10): the card carries `landFetch`, and one of its fetch lines
 *  is ungated. A fetch SPELL (Cultivate) is paid once and its cost is not held against it; a permanent's activation (Myriad
 *  Landscape's {2}) must make more than it costs, as any costed line must. */
export function isFetchSource(dc: DeckCard): boolean {
  const fetch = dc.tags?.landFetch;
  if (!fetch) return false;
  // A PLANESWALKER'S FETCH is a source only if it can be activated the turn the walker is cast (owner 2026-10-13): Nissa, Worldwaker's -7 and Nissa, Who
  // Shakes the World's -8 cannot, from loyalty 3 and 5.
  return cardLines(dc).some((l) => l.source === "fetch" && l.gate === null && (fetch.kind === "spell" || l.net >= 1) && (!isLoyaltyAbility(l) || usableLoyalty(l)));
}

/** The lines on which a land's mana is conditional, for the land score (never cut or upgraded for what it cannot be weighed on): a
 *  gate (Tainted Peak), a restriction (Cavern of Souls), a colour bounded outside the card (Exotic Orchard), a scaling amount
 *  (Gaea's Cradle), or a production derive could not read. A filter land's costed line is not one (it is read by cost). */
export function hasConditionalMana(dc: DeckCard): boolean {
  return cardLines(dc).some((l) => (l.source === "activated" || l.source === "static-grant") && l.cost.tap && l.cost.mana === 0
    && (l.gate !== null || l.restriction !== null || l.unread || l.amount.scales !== null
      || l.anyColour === "chosen" || l.anyColour === "opponent-lands" || l.anyColour === "lands-you-could" || l.anyColour === "among" || l.anyColour === "grantee"));
}

/** THE MANA-VALUE FLOOR OF A RESTRICTED LINE, or null when the line is unrestricted or restricted some other way: "Spend this mana only to cast
 *  spells with mana value 4 or greater" (Ashling, Rimebound). The one restriction a consumer that knows every card's mana value can settle against
 *  the deck (the goldfish); every other restriction ("to activate abilities", "elemental spells") is a limit on what the mana is FOR. */
export function minManaValue(line: ManaLine): number | null {
  const m = /^to cast spells with mana value (\d+) or greater$/.exec(line.restriction?.spend ?? "");
  return m ? Number(m[1]) : null;
}

/** The lines whose mana arrives when a land enters (Lotus Cobra: "Whenever a land you control enters, add one mana of any color"). Landfall is not
 *  an event of its own: it is `enters` with a land `triggerSubject`; `enters` with "this creature" is the card's own enters trigger (Burning-Tree
 *  Emissary), which makes mana once and is no source. CEILING: the subject is read as the one printed shape the corpus holds ("a land you control"). */
export const isLandfall = (line: ManaLine): boolean =>
  line.source === "trigger" && line.trigger === "enters" && /^an?(?:other)? land you control$/i.test(line.triggerSubject ?? "");

/** The lines whose mana arrives at the beginning of a phase (Coalition Relic's first main phase, Chaos Moon's upkeep, Go-Shintai's end step).
 *  CEILING: "your NEXT main phase" (Mana Drain, Plasm Capture) is a one-shot wearing a trigger, and its derived subject says only "you"; both scale
 *  their amount, which every consumer refuses, so nothing reads the difference. */
export const isPhaseTrigger = (line: ManaLine): boolean =>
  line.source === "trigger" && (line.trigger === "main-phase" || line.trigger === "upkeep" || line.trigger === "end-step");
