import type { DeckCard } from "./types.js";

/** THE COST-TO-EFFECT RATE, AS AN INTERVAL PER FAMILY (roadmap X2; owner 2026-09-17).
 *
 *  "4 mana draw 1 card and 4 mana draw 3 cards is the same" to every model in this repo. This is
 *  the number that tells them apart, and it is deliberately not one number: "Rhystic Study can
 *  draw you 0 cards at worst, but it is still 'opponents' spells cost 1 more', where 3 mana draw 2
 *  is always the same." So a rate carries a FLOOR and a CEILING of what the ability yields for the
 *  mana it charges. A fixed one-shot is a point. A trigger has a floor of 0 -- it may never fire --
 *  and a ceiling only a deck can estimate, so it is open here. An X spell is a slope. The payment
 *  that stops an effect (CR 118.12a, `Ability.unless`) is the floor's fallback, carried verbatim.
 *
 *  PER FAMILY, NEVER ACROSS. Cards per mana and damage per mana are two rates; a constant that
 *  trades one for the other is the coefficient that killed edge magnitude three times (engineering
 *  log 2026-08-16), and this file has none. Sort within a family by floor, break on ceiling, print
 *  both -- folding them into one number is the same constant by another name.
 *
 *  RECORDED, NOT JUDGED. This says what a card charges for what it does. Whether the deck wants it
 *  is the synergy engine's question, and the two stay separate on purpose (spec 2026-09-04). */

export type RateFamily = "cards" | "damage" | "mana" | "life" | "life-loss" | "mill" | "tokens" | "counters"
  | "search" | "recursion" | "untap" | "flicker" | "copies";

/** The effect kinds a family reads. The census (2026-09-17) found an amount on 79% of draw
 *  abilities and 99% of damage; mana read 6% until DERIVE 160 put the mana a mana ability adds on
 *  its amount, which is the Signet-versus-Sphere comparison this axis was named for. The five that
 *  followed (owner 2026-09-17, "what about the rest of effects") carry a numeric amount on 89%,
 *  92%, 70%, 84% and 55% of their abilities. Tokens are a COUNT -- a 1/1 and a 4/4 read the same
 *  until the token's size joins the unit -- and counters a count across kinds. Drain is not here:
 *  its amount sits on the clause's two actions and derive drops it composing the kind. */
const FAMILY_OF: Record<string, RateFamily> = {
  "draw-card": "cards", damage: "damage", "mana-generation": "mana", lifegain: "life",
  "player-life-loss": "life-loss", mill: "mill", "token-generation": "tokens", "counter-placement": "counters",
  // THE UNIT EFFECTS, since DERIVE 161 reads "a card" and "up to two" off the object: Vampiric
  // Tutor is 1 card for {B} and Diabolic Tutor 1 for {3}{B}, which is the draw comparison
  // applied to tutors. Extra turns, scry, surveil and clone stay out: no amount, or card quality
  // rather than yield.
  search: "search", "graveyard-recursion": "recursion", untap: "untap", flicker: "flicker", "copy-spell": "copies",
};
/** The families whose yield must be YOURS: another player's cards, life or tokens are not your
 *  rate (Swords to Plowshares' life goes to the creature's controller). Mana is not here: "Add
 *  {G}" is always the controller's, and derive marks its subject `any` (18 of 758 rows survived
 *  the first draft that filtered it). */
const YOURS = new Set<RateFamily>(["cards", "life", "tokens"]);
/** The families whose yield must NOT be yours: Flame Rift's damage to you and a cost in life are
 *  what the card charges, not what it does for you. Mill and counters are read whoever they land
 *  on -- self-mill is a purpose, and a counter goes where it is put. */
const NOT_YOURS = new Set<RateFamily>(["damage", "life-loss"]);
/** The families read whoever the target is, except an OPPONENT'S own: "target player searches"
 *  and "each opponent untaps" are not your rate. */
const NOT_THEIRS = new Set<RateFamily>(["search", "recursion", "untap", "flicker", "copies"]);

export interface Rate {
  family: RateFamily;
  /** `on-cast`, `triggered`, `activated`: what has to happen for the yield. */
  kind: string;
  /** What one resolution, trigger or activation yields, in the family's unit, NET of what the same
   *  ability gives back (`back`). 0 on a slope. */
  amount: number;
  /** THE CARDS THE ABILITY PUTS BACK OR DISCARDS FOR THE DRAW (owner 2026-09-17: "Brainstorm
   *  makes you draw 3 cards, but then you have to put 2 back"): Brainstorm is +1, a loot is 0 --
   *  selection, not advantage. Read off the companion ability derive made from the same clause:
   *  a `top-set` from the hand, or a `discard` emit, on the same kind and cost. CEILING: the
   *  pairing is card-wide (an ability carries no clause id), guarded by kind and cost; the
   *  upgrade path is a clause id on the ability from derive. */
  back?: number;
  /** The mana it charges: an activation's own cost, else the card's; the fixed part of an X cost. */
  mana: number;
  /** THE CARD HAD TO BE CAST FIRST (owner 2026-09-17: "you are not accounting for actually
   *  casting the card to then use its ability"). On an activation, the card's own mana: the
   *  first yield costs `cast + mana`, and only a repeatable one amortises to `mana` after. */
  cast?: number;
  /** EQUIPPING IS A COST TOO (owner 2026-09-17, Paradise Mantle at {0}): on an Equipment, the
   *  cheapest printed Equip cost, paid before the equipped creature's ability can be used. In the
   *  first price with the cast; the equipment stays on for the later ones. */
  equip?: number;
  /** Yield per further mana, on an X cost. */
  slope?: number;
  /** How often it can happen: `once`, `repeatable`, `per-cycle`, `per-turn`. */
  repeats: string;
  /** What is guaranteed for the mana: the amount for a one-shot or an activation, 0 for a trigger
   *  or when a payment can stop it. */
  floor: number;
  /** The amount for a one-shot or an activation; null when open -- a trigger, or a slope. */
  ceiling: number | null;
  /** The payment that stops the effect, when the card names one and someone else pays it. */
  fallback?: { cost: string; payer: string };
  /** THE AMOUNT SITS BEHIND A CONDITION THE ABILITY CANNOT SHOW: Fiery Gambit's nine cards behind
   *  coin flips, Diviner's Lockbox's three behind a guess, Unholy Heat's six behind delirium,
   *  Thunder Magic's eight behind a tier, Kazandu Tuskcaller's tokens behind level up. The floor is
 *  0 and the amount is the ceiling. CEILING:
   *  read off the card's printed text by a word list (`CONDITION`), card-wide, so a card with one
   *  conditional ability marks its plain one too; the upgrade path is a condition on the ability
   *  from derive. Measured 2026-09-17: 258 of 590 cast draws with an amount sit on such a card. */
  conditional?: true;
  /** THE MANA IS NOT THE WHOLE PRICE: an activation cost with words in it -- "{R}, Sacrifice
   *  this creature", "{2}, Discard a card" -- charges more than `mana` says. Bloodfire Colossus
   *  read as 6 damage for one mana on the first build. Recorded so a per-mana sort can leave it out;
   *  a cast's additional cost is caught by `conditional` from the printed text. */
  extraCost?: true;
  /** THE TOKEN'S SIZE, when the ability states one ("two 1/1 white Soldier creature tokens"): the
   *  count is the rate's unit and this is printed beside it, because a 1/1 and a 4/4 are not the
   *  same token (owner residue, 2026-09-17). Absent on a Treasure, a Clue, or a variable size. */
  size?: string;
  /** SUMMONING SICKNESS (CR 302.6; owner 2026-09-17). A creature's activated ability with {T} or
   *  {Q} in its cost, and its own attack trigger, wait until the creature has been yours since your
   *  turn began: the first yield is a turn later than the mana. The same for a tap ability an
   *  Equipment or a creature Aura grants: the creature carrying it is the one that taps. Absent
   *  with printed haste and on everything else. A turn has no price in mana without the constant
   *  this file refuses, so the sort breaks a per-mana tie on it and the tile prints it. */
  delayed?: true;
}

/** THE MANA IN A COST STRING. Generic counts as written, every pip as one (a hybrid is one either
 *  way, a Phyrexian pip too -- the mana it asks for, not the life it accepts), a tap, untap or
 *  energy symbol as nothing. `null` on an X: the caller reads that as a slope. Not the goldfish's
 *  `parseCost`, which prices a hand and counts `{T}` as a generic mana. */
export function manaOf(cost: string | undefined): number | null {
  if (cost === undefined) return null;
  let total = 0;
  for (const symbol of cost.match(/\{[^{}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1).toUpperCase();
    if (inner.includes("X")) return null;
    if (inner === "T" || inner === "Q" || inner === "E") continue;
    const parts = inner.split("/");
    const n = Number(parts[0]);
    total += parts.length === 1 && Number.isInteger(n) ? n : 1;
  }
  return total;
}

/** The words that put an amount behind a condition on a card's printed text. A list, not a parse:
 *  the derived ability carries the amount and nothing about what has to be true for it. */
const CONDITION = /\bif\b|\bunless\b|\binstead\b|\bas long as\b|\blevel up\b|flip a coin|choose one|additional cost|\btiered\b|\bkicked\b|\bup to\b|\bthat many\b/i;

const integer = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** EVERY RATE THE CARD'S ABILITIES STATE, one per ability that a family reads and that has a
 *  number to read. Refuses, per ability and silently, when: the effect is another player's
 *  (`control` not you); the amount is a count of something rather than a number, except an X on an
 *  X cost; the ability's cost has no mana to read; or the payment that stops it is YOURS, which is
 *  an upkeep cost and not a rate. A refusal here is an ability with no row, never a guessed row.
 *  AN UNSET AMOUNT IS REFUSED TOO: 578 of your-draw abilities carry none (census 2026-09-17), and
 *  468 of those print "draw a card", but the other 110 print "draw two cards" or "draw cards equal
 *  to", so a default of 1 would be a guess wrong one time in five. The fix is a refresh, not a
 *  default (`dropsUnitAmount`, not yet written). */
export function ratesOf(d: DeckCard): Rate[] {
  const out: Rate[] = [];
  const types = d.tags?.characteristics.types ?? [];
  const creature = types.includes("creature") || /\bCreature\b/.test(d.card.typeLine ?? "");
  const land = types.includes("land") || /\bLand\b/.test(d.card.typeLine ?? "");
  const equipment = /\bEquipment\b/.test(d.card.typeLine ?? "");
  const creatureAura = /\bAura\b/.test(d.card.typeLine ?? "") && /^Enchant creature\b/m.test(d.card.oracleText ?? "");
  /** The cheapest printed "Equip {N}"; `null` when every Equip line charges something other than
   *  mana ("Equip—Pay 2 life"), 0 when the card prints none. */
  const equipCost = ((): number | null => {
    const costs = [...(d.card.oracleText ?? "").matchAll(/^Equip\b[^\n{]*(\{[^\n]*)$/gm)].map((m) => manaOf(m[1]!));
    if (costs.length === 0) return equipment ? null : 0;
    const priced = costs.filter((n): n is number => n !== null);
    return priced.length > 0 ? Math.min(...priced) : null;
  })();
  const haste = (d.card.keywords ?? []).some((k) => k.toLowerCase() === "haste");
  // IMPRINT IS A CARD, NOT MANA (Chrome Mox at {0} led "adds mana"): every activation on an imprint
  // card charges the exiled card first, so its rate is more than mana says.
  const imprint = (d.card.keywords ?? []).some((k) => k.toLowerCase() === "imprint");
  const conditional = CONDITION.test(d.card.oracleText ?? "");
  /** CR 302.6, on this card: a tap or untap activation, or the card's own attack trigger. */
  const sick = (a: { kind: string; cost?: string; trigger?: { verbs?: string[]; subject?: { self?: boolean } } }): boolean =>
    (creature && !haste && (
      (a.kind === "activated" && /\{[TQ]\}/i.test(a.cost ?? ""))
      || (a.kind === "triggered" && a.trigger?.subject?.self === true && (a.trigger.verbs ?? []).includes("attacks"))))
    || ((equipment || creatureAura) && a.kind === "activated" && /\{[TQ]\}/i.test(a.cost ?? ""));
  const abilities = d.tags?.abilities ?? [];
  const manaCost = (d.card as { manaCost?: string }).manaCost;
  /** What the same clause takes back for a draw: `top-set` from the hand (Brainstorm), or a
   *  `discard` emit (a loot), on the same kind and cost. `null` when a companion states no amount
   *  ("discard a card", the `dropsUnitAmount` gap) -- the draw is refused rather than left gross. */
  const backOf = (a: (typeof abilities)[number]): number | null => {
    let back = 0;
    for (const b of abilities) {
      if (b === a || b.kind !== a.kind || b.cost !== a.cost) continue;
      const putsBack = b.effect?.kind === "top-set" && b.effect.subject?.fromZone === "hand" && b.effect.subject.control === "you";
      const discards = (b.emits ?? []).some((e) => e.verb === "discard" && e.subject?.control === "you");
      if (!putsBack && !discards) continue;
      const n = integer(b.amount);
      if (n === null) return null;
      back += n;
    }
    return back;
  };
  for (const a of abilities) {
    const family = FAMILY_OF[a.effect?.kind ?? ""];
    if (family === undefined) continue;
    const control = a.effect?.subject?.control;
    // WHOSE YIELD: cards are a rate only when YOU draw them; damage only when it is not to your
    // own side (Flame Rift's damage to you is a cost the card charges, not a thing it does for you).
    if (YOURS.has(family) && control !== undefined && control !== "you") continue;
    if (NOT_YOURS.has(family) && control === "you") continue;
    if (NOT_THEIRS.has(family) && control === "opp") continue;
    // A LAND'S MANA IS ITS LAND DROP, not a price in mana: every basic would top "adds mana" at
    // infinity. The same for any land activation that charges no mana of its own (Fountain of Cho's
    // "{T}: Put a storage counter" topped "puts counters" as free); one that does (Castle
    // Locthwain) is priced on it, with a cast of nothing.
    if (family === "mana" && land) continue;
    if (a.unless && a.unless.payer === "you") continue;
    const cost = a.kind === "activated" ? a.cost : manaCost;
    // NO MANA TO READ: a loyalty cost ("+1", "−3", "0"; CR 606.5) is paid in loyalty, not mana, and
    // an empty or words-only cost states none. Measured 2026-09-17 on the first chip sort: 341
    // "+1" abilities read as free and put every planeswalker above Brainstorm.
    if (cost === undefined || !/\{[^{}]+\}/.test(cost)) continue;
    // THE CAST BEFORE THE ACTIVATION: a land charges no mana to land; a nonland with no printed
    // cost (Sol Talisman, suspend only; Scryfall prints it as "", not absent) has no cast to add,
    // nor does a card with X in its own cost, so their activations are refused.
    const cast = a.kind !== "activated" ? undefined : !manaCost ? (land && (manaOf(cost) ?? 0) > 0 ? 0 : null) : manaOf(manaCost);
    if (cast === null) continue;
    // An Equipment's activation is the equipped creature's, and its trigger watches the equipped
    // creature (Skullclamp): the Equip cost is paid before either. An Equip line that charges no
    // mana is more than mana, and the rate says so.
    const equipped = equipment && a.kind !== "on-cast";
    if (equipped && equipCost === null) continue;
    const castOf = { ...(cast === undefined ? {} : { cast }), ...(equipped && equipCost ? { equip: equipCost } : {}) };
    const extra = a.kind === "activated" && (imprint || /[A-Za-z]/.test(cost.replace(/\{[^{}]+\}/g, "")));
    const repeats = a.repeats ?? (a.kind === "on-cast" ? "once" : "repeatable");
    const mana = manaOf(cost);
    // AN X COST IS A SLOPE: the fixed pips are the mana, each further mana is one of the unit.
    if (mana === null) {
      if (a.effect?.scaling !== "x-cost") continue;
      const fixed = manaOf(cost.replace(/\{X\}/gi, "")) ?? 0;
      out.push({ family, kind: a.kind, amount: 0, mana: fixed, ...castOf, slope: 1, repeats, floor: 0, ceiling: null, ...(extra ? { extraCost: true as const } : {}), ...(sick(a) ? { delayed: true as const } : {}) });
      continue;
    }
    const gross = integer(a.amount);
    if (gross === null || (a.effect?.scaling !== undefined && a.effect.scaling !== "fixed")) continue;
    const back = family === "cards" ? backOf(a) : 0;
    if (back === null) continue;
    const amount = Math.max(0, gross - back);
    const stats = (a.effect?.subject as { stats?: { metric: string; op: string; value: number }[] } | undefined)?.stats ?? [];
    const power = stats.find((x) => x.metric === "power" && x.op === "eq")?.value, toughness = stats.find((x) => x.metric === "toughness" && x.op === "eq")?.value;
    const size = family === "tokens" && power !== undefined && toughness !== undefined ? `${power}/${toughness}` : undefined;
    // A TRIGGER MAY NEVER FIRE; an activation or a cast yields every time it is paid for.
    const open = a.kind === "triggered" || a.kind === "static";
    const stopped = a.unless !== undefined;
    out.push({
      family, kind: a.kind, amount, ...(back > 0 ? { back } : {}), ...(size ? { size } : {}), mana, ...castOf, repeats,
      floor: open || stopped || conditional ? 0 : amount,
      ceiling: open ? null : amount,
      ...(stopped ? { fallback: { cost: a.unless!.cost, payer: a.unless!.payer } } : {}),
      ...(conditional && !open && !stopped ? { conditional: true as const } : {}),
      ...(extra ? { extraCost: true as const } : {}),
      ...(sick(a) ? { delayed: true as const } : {}),
    });
  }
  return out;
}

/** THE RATE A SEARCH ROW CARRIES: the floor and the mana it costs, the ceiling (null when open)
 *  and the mana IT costs. Two prices because an activation's first yield includes the cast and a
 *  repeatable one's later yields do not. Four numbers, not the record, because the facet index
 *  is fetched by the browser. */
export type RateSpan = [floor: number, floorMana: number, ceiling: number | null, ceilingMana: number, delayed?: 1];

const desc = (x: number, y: number): number => (x === y ? 0 : y > x ? 1 : -1);
/** Per mana; a yield for no mana at all is the best rate there is, and no yield for nothing is 0. */
const per = (n: number | null, mana: number): number => (n === null ? Infinity : mana > 0 ? n / mana : n > 0 ? Infinity : 0);

/** THE ORDER WITHIN A FAMILY (spec 2026-09-04 step 3): floor per its mana, ceiling per its mana
 *  to break it, an open ceiling above any bounded one -- a trigger's yield is what a deck makes of
 *  it, a one-shot's is written down -- then the one that yields THIS turn (CR 302.6) -- then the
 *  raw yield (two free rates tie per mana), then the cheaper first yield. Negative when `a` is better. A free rate sorts FIRST: it did not on the
 *  first build (2026-09-17), when an activation's own {T} divided by zero and 103 tap abilities
 *  sat above Brainstorm; with the cast in the price, free means Mana Crypt, and a land's mana is
 *  refused before it gets here. */
export function compareRates(a: RateSpan, b: RateSpan): number {
  return desc(per(a[0], a[1]), per(b[0], b[1])) || desc(per(a[2], a[3]), per(b[2], b[3]))
    || (a[4] ?? 0) - (b[4] ?? 0)
    || desc(a[0], b[0]) || desc(a[2] ?? Infinity, b[2] ?? Infinity) || a[1] - b[1];
}

/** The row's span of a rate: the first yield is priced with the cast and the equip, only a
 *  repeatable activation's ceiling amortises to the activation alone, and a fifth element marks
 *  the yield that waits a turn. */
export function spanOf(r: Rate): RateSpan {
  const first = r.mana + (r.cast ?? 0) + (r.equip ?? 0);
  const span: RateSpan = [r.floor, first, r.ceiling, r.repeats === "once" ? first : r.mana];
  if (r.delayed) span[4] = 1;
  return span;
}

/** THE BEST RATE PER FAMILY among a card's rates, for the row. An activation that charges more
 *  than mana (`extraCost`) is left out: Bloodfire Colossus is not 6 damage for {R}. */
export function bestRates(rates: Rate[]): Partial<Record<RateFamily, RateSpan>> {
  const out: Partial<Record<RateFamily, RateSpan>> = {};
  for (const r of bestPerFamily(rates)) out[r.family] = spanOf(r);
  return out;
}
/** The best rate per family, as records: what `bestRates` spans, and what a note (`size`) reads. */
export function bestPerFamily(rates: Rate[]): Rate[] {
  const best = new Map<RateFamily, Rate>();
  for (const r of rates) {
    if (r.extraCost) continue;
    const have = best.get(r.family);
    if (have === undefined || compareRates(spanOf(r), spanOf(have)) < 0) best.set(r.family, r);
  }
  return [...best.values()];
}
