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

export type RateFamily = "cards" | "damage";

/** The effect kinds a family reads. The census (2026-09-17) found an amount on 79% of draw
 *  abilities and 99% of damage; mana is 6% and needs the emit's symbols, so it is not here yet. */
const FAMILY_OF: Record<string, RateFamily> = { "draw-card": "cards", damage: "damage" };

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
   *  Thunder Magic's eight behind a tier. The floor is 0 and the amount is the ceiling. CEILING:
   *  read off the card's printed text by a word list (`CONDITION`), card-wide, so a card with one
   *  conditional ability marks its plain one too; the upgrade path is a condition on the ability
   *  from derive. Measured 2026-09-17: 258 of 590 cast draws with an amount sit on such a card. */
  conditional?: true;
  /** THE MANA IS NOT THE WHOLE PRICE: an activation cost with words in it -- "{R}, Sacrifice
   *  this creature", "{2}, Discard a card" -- charges more than `mana` says. Bloodfire Colossus
   *  read as 6 damage for one mana on the first build. Recorded so a per-mana sort can leave it out;
   *  a cast's additional cost is caught by `conditional` from the printed text. */
  extraCost?: true;
  /** SUMMONING SICKNESS (CR 302.6; owner 2026-09-17). A creature's activated ability with {T} or
   *  {Q} in its cost, and its own attack trigger, wait until the creature has been yours since your
   *  turn began: the first yield is a turn later than the mana. Absent with printed haste, on a
   *  noncreature, and on everything else. Recorded, so a consumer that counts turns can. */
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
const CONDITION = /\bif\b|\bunless\b|\binstead\b|\bas long as\b|flip a coin|choose one|additional cost|\btiered\b|\bkicked\b|\bup to\b|\bthat many\b/i;

const integer = (s: string | undefined): number | null => {
  if (s === undefined) return null;
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
  const haste = (d.card.keywords ?? []).some((k) => k.toLowerCase() === "haste");
  const conditional = CONDITION.test(d.card.oracleText ?? "");
  /** CR 302.6, on this card: a tap or untap activation, or the card's own attack trigger. */
  const sick = (a: { kind: string; cost?: string; trigger?: { verbs?: string[]; subject?: { self?: boolean } } }): boolean =>
    creature && !haste && (
      (a.kind === "activated" && /\{[TQ]\}/i.test(a.cost ?? ""))
      || (a.kind === "triggered" && a.trigger?.subject?.self === true && (a.trigger.verbs ?? []).includes("attacks")));
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
    if (family === "cards" && control !== undefined && control !== "you") continue;
    if (family === "damage" && control === "you") continue;
    if (a.unless && a.unless.payer === "you") continue;
    const cost = a.kind === "activated" ? a.cost : manaCost;
    // NO MANA TO READ: a loyalty cost ("+1", "−3", "0"; CR 606.5) is paid in loyalty, not mana, and
    // an empty or words-only cost states none. Measured 2026-09-17 on the first chip sort: 341
    // "+1" abilities read as free and put every planeswalker above Brainstorm.
    if (cost === undefined || !/\{[^{}]+\}/.test(cost)) continue;
    // THE CAST BEFORE THE ACTIVATION: a land charges no mana to land; a card with X in its own
    // cost has no honest cast to add, so its activations are refused.
    const cast = a.kind !== "activated" ? undefined : manaCost === undefined ? 0 : manaOf(manaCost);
    if (cast === null) continue;
    const castOf = cast === undefined ? {} : { cast };
    const extra = a.kind === "activated" && /[A-Za-z]/.test(cost.replace(/\{[^{}]+\}/g, ""));
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
    // A TRIGGER MAY NEVER FIRE; an activation or a cast yields every time it is paid for.
    const open = a.kind === "triggered" || a.kind === "static";
    const stopped = a.unless !== undefined;
    out.push({
      family, kind: a.kind, amount, ...(back > 0 ? { back } : {}), mana, ...castOf, repeats,
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
export type RateSpan = [floor: number, floorMana: number, ceiling: number | null, ceilingMana: number];

const desc = (x: number, y: number): number => (x === y ? 0 : y > x ? 1 : -1);
const priced = (s: RateSpan): boolean => s[1] > 0;
/** Per mana when there is mana; for nothing, the yield itself (Infinity when there is one). */
const per = (n: number | null, mana: number): number => (n === null ? Infinity : mana > 0 ? n / mana : n > 0 ? Infinity : 0);

/** THE ORDER WITHIN A FAMILY (spec 2026-09-04 step 3): every rate with mana to divide by before
 *  any free one -- dividing by zero put 103 tap abilities above Brainstorm on the first build
 *  (2026-09-17), and since the cast counts, only a land's tap ability is free now; then floor per
 *  its mana, ceiling per its mana to break it, an open ceiling above any bounded one -- a
 *  trigger's yield is what a deck makes of it, a one-shot's is written down -- then the raw yield
 *  (two free rates tie per mana), then the cheaper first yield. Negative when `a` is better. */
export function compareRates(a: RateSpan, b: RateSpan): number {
  if (priced(a) !== priced(b)) return priced(a) ? -1 : 1;
  return desc(per(a[0], a[1]), per(b[0], b[1])) || desc(per(a[2], a[3]), per(b[2], b[3]))
    || desc(a[0], b[0]) || desc(a[2] ?? Infinity, b[2] ?? Infinity) || a[1] - b[1];
}

/** The row's span of a rate: the first yield is priced with the cast, and only a repeatable
 *  activation's ceiling amortises to the activation alone. */
export function spanOf(r: Rate): RateSpan {
  const first = r.mana + (r.cast ?? 0);
  return [r.floor, first, r.ceiling, r.repeats === "once" ? first : r.mana];
}

/** THE BEST RATE PER FAMILY among a card's rates, for the row. An activation that charges more
 *  than mana (`extraCost`) is left out: Bloodfire Colossus is not 6 damage for {R}. */
export function bestRates(rates: Rate[]): Partial<Record<RateFamily, RateSpan>> {
  const out: Partial<Record<RateFamily, RateSpan>> = {};
  for (const r of rates) {
    if (r.extraCost) continue;
    const t = spanOf(r);
    const have = out[r.family];
    if (have === undefined || compareRates(t, have) < 0) out[r.family] = t;
  }
  return out;
}
