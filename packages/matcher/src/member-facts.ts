import type { CardTags, Repeats } from "@edh-seer/tagger";

/** WHAT ONE ABILITY DOES FOR ONE EVENT KEY, packed into a single number so the event shards ship
 *  one small integer per member ability (owner, 2026-10-24: "filter by amount of the
 *  effect happening ... and also repeatability of the effect", and "categorization if cast ability,
 *  triggered, replacement effect, activated ability").
 *
 *  Three fields, all read off the derived `Ability` as it is -- nothing here re-reads oracle text:
 *  - KIND: `Ability.kind`, with a CR 614 multiplier (`replacement: true`) split out of `static`,
 *    because a player searching "replacement effects for damage" means Torbran, not every anthem.
 *    `on-cast` is the spell's own effect on resolution; a "whenever you cast" trigger is `triggered`.
 *  - REPEATS: `Ability.repeats`, unset kept unset ("the rules could not tell" is a real answer).
 *  - AMOUNT: `Ability.amount`, PER OCCURRENCE (owner, 2026-10-24: "per occurrence, cause I am looking
 *    for noncombat pingers that ping for exactly 1 dmg"). A digit string is a fixed size; anything
 *    else stated ("X", "that much") is variable; nothing stated is NOT one -- see `Ability.amount`.
 *
 *  - CHANGE (askers only): what a replacement does to the event it hears -- "+2" (Torbran) or "x3"
 *    (Fiery Emancipation) -- shipped in the amount slot as its own two shapes, so one size filter
 *    reads "exactly 1" on a pinger and "doubles" on a doubler.
 *
 *  Layout: `value * 512 + shape * 64 + repeats * 8 + kind`, three bits each for kind, repeats and
 *  shape (`AMOUNT_SHAPES`), the rest the number. */
export const ABILITY_KINDS = ["spell", "triggered", "activated", "static", "replacement"] as const;
export type FactKind = (typeof ABILITY_KINDS)[number];

/** THE REPEATS LADDER, LEAST OFTEN FIRST, with 0 for "could not tell". The order is the one
 *  `effectOrder` ranks on: once a game, once a round, every player's turn, as often as it happens.
 *  `continuous` sits last because a static ability is always on -- it does not "fire" at all, and a
 *  minimum-repeatability filter should keep it rather than drop it below `once`. */
export const REPEATS_LADDER = ["once", "per-cycle", "per-turn", "repeatable", "continuous"] as const satisfies readonly Repeats[];

export type FactAmount =
  | { kind: "unstated" } | { kind: "variable" } | { kind: "fixed"; value: number }
  /** A replacement's change to the event it hears: "plus 2", "double", "triple". */
  | { kind: "plus"; value: number } | { kind: "times"; value: number };
const AMOUNT_SHAPES = ["unstated", "variable", "fixed", "plus", "times"] as const satisfies readonly FactAmount["kind"][];
export interface MemberFact { kind: FactKind; repeats: Repeats | undefined; amount: FactAmount }

type Ability = CardTags["abilities"][number];

/** CEILING: `replacement` is stamped only where `derive/replacement.ts` reads the "would ...
 *  instead" frame -- counters, tokens, damage, mill, draw, proliferate. Other CR 614 replacements
 *  keep `static` here: graveyard hate (Rest in Peace, Leyline of the Void, via
 *  `graveyard-replacement.ts`), enters-tapped and enters-with-counters riders, and prevention. The
 *  upgrade path is stamping `replacement` from those derive passes too. */
export function factKindOf(a: Ability): FactKind {
  if (a.replacement === true) return "replacement";
  switch (a.kind) {
    case "on-cast": return "spell";
    case "triggered": return "triggered";
    case "activated": return "activated";
    default: return "static";
  }
}

/** `Ability.amount` as a size. "1,000" is a thousand, not variable: the card prints a number. */
export function factAmountOf(amount: string | undefined): FactAmount {
  const s = (amount ?? "").trim().replace(/,/g, "");
  if (s === "") return { kind: "unstated" };
  return /^\d+$/.test(s) ? { kind: "fixed", value: Number(s) } : { kind: "variable" };
}

export function packFact(f: MemberFact): number {
  const value = "value" in f.amount ? f.amount.value : 0;
  const repeats = f.repeats === undefined ? 0 : REPEATS_LADDER.indexOf(f.repeats as (typeof REPEATS_LADDER)[number]) + 1;
  return value * 512 + AMOUNT_SHAPES.indexOf(f.amount.kind) * 64 + repeats * 8 + ABILITY_KINDS.indexOf(f.kind);
}

export function unpackFact(n: number): MemberFact {
  const kind = ABILITY_KINDS[n % 8] ?? "static";
  const r = Math.floor(n / 8) % 8;
  const shape = AMOUNT_SHAPES[Math.floor(n / 64) % 8] ?? "unstated";
  const value = Math.floor(n / 512);
  return {
    kind,
    repeats: r === 0 ? undefined : REPEATS_LADDER[r - 1],
    amount: shape === "unstated" || shape === "variable" ? { kind: shape } : { kind: shape, value },
  };
}

export function factOf(a: Ability, withAmount: boolean): number {
  return packFact({ kind: factKindOf(a), repeats: a.repeats, amount: withAmount ? factAmountOf(a.amount) : { kind: "unstated" } });
}

/** EACH KEY A CARD SUPPLIES, WITH THE FACTS OF THE ABILITIES THAT SUPPLY IT. `keysOf` is the
 *  caller's ability-to-key reading (`supplyFactsOfCard` in `partners-core`), taken as an argument so
 *  this file stays free of the matcher's key machinery. A key the card supplies only by being played
 *  (Sol Ring and "an artifact enters") or by a printed keyword has no ability, so no facts. */
export function supplyFactsOf(abilities: readonly Ability[], keysOf: (a: Ability) => readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const a of abilities) {
    const fact = factOf(a, true);
    for (const k of new Set(keysOf(a))) {
      const b = out.get(k);
      if (!b) out.set(k, [fact]);
      else if (!b.includes(fact)) b.push(fact);
    }
  }
  return out;
}

/** EACH KEY A CARD ASKS FOR, WITH THE FACTS OF THE ABILITIES THAT ASK. No amount on this side: a
 *  trigger's own effect size is not what it asks for, and a replacement's "+2" or "triple" is a
 *  modifier the schema does not record as a number yet.
 *  CEILING: replacement magnitudes ("+2", "double", "triple") are not shipped, so the amount filter
 *  cannot tell Torbran from Fiery Emancipation. `tokenMultiplier` covers tokens only. */
export function demandFactsOf(abilities: readonly Ability[], keysOf: (a: Ability) => readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const a of abilities) {
    const fact = factOf(a, false);
    for (const k of new Set(keysOf(a))) {
      const b = out.get(k);
      if (!b) out.set(k, [fact]);
      else if (!b.includes(fact)) b.push(fact);
    }
  }
  return out;
}

/** WHAT A SEARCH ASKS OF ONE MEMBER'S ABILITIES. Every field is optional; an empty filter keeps
 *  everything, including members with no facts. */
export interface FactFilter {
  /** Ability kinds to keep; empty or absent = any. */
  kinds?: readonly FactKind[];
  /** Keep abilities firing at least this often on `REPEATS_LADDER`. An unlabelled one is dropped. */
  minRepeats?: Repeats;
  /** Inclusive size range, per occurrence. `max` absent = no upper bound. */
  amountMin?: number;
  amountMax?: number;
  /** Keep variable ("X", "that much") and unstated sizes when a range is set. Default false: a
   *  player asking for "exactly 1" did not ask for "equal to its power". */
  includeVariable?: boolean;
  /** A replacement's change only: "plus" (Torbran's +2) or "times" (a doubler). Absent = either.
   *  The range above then reads the change's number -- "times, 2 to 2" is the doublers. */
  changeOp?: "plus" | "times";
}

export const isEmptyFilter = (f: FactFilter): boolean =>
  (f.kinds?.length ?? 0) === 0 && f.minRepeats === undefined && f.amountMin === undefined && f.amountMax === undefined
  && f.changeOp === undefined;

export function factPasses(f: MemberFact, q: FactFilter): boolean {
  if (q.kinds && q.kinds.length > 0 && !q.kinds.includes(f.kind)) return false;
  if (q.minRepeats !== undefined) {
    if (f.repeats === undefined) return false;
    if (REPEATS_LADDER.indexOf(f.repeats as (typeof REPEATS_LADDER)[number]) < REPEATS_LADDER.indexOf(q.minRepeats as (typeof REPEATS_LADDER)[number])) return false;
  }
  const change = f.amount.kind === "plus" || f.amount.kind === "times";
  // A CHANGE IS ASKED FOR BY ITS OP, and an op asks for nothing else: "times" keeps only doublers.
  if (q.changeOp !== undefined && f.amount.kind !== q.changeOp) return false;
  if (q.amountMin !== undefined || q.amountMax !== undefined) {
    if (f.amount.kind !== "fixed" && !change) return q.includeVariable === true;
    const value = (f.amount as { value: number }).value;
    if (q.amountMin !== undefined && value < q.amountMin) return false;
    if (q.amountMax !== undefined && value > q.amountMax) return false;
  }
  return true;
}

/** A MEMBER PASSES WHEN ONE OF ITS ABILITIES PASSES THE WHOLE FILTER -- not one ability for the
 *  kind and another for the size, which would keep a card whose 3-damage activation and 1-damage
 *  trigger together "ping for 1 repeatedly" when neither does. A member with no facts (it supplies
 *  the key by being played) passes only an empty filter. */
export function memberPasses(facts: readonly number[] | undefined, q: FactFilter): boolean {
  if (isEmptyFilter(q)) return true;
  return (facts ?? []).some((n) => factPasses(unpackFact(n), q));
}

/** HOW MANY OF A SIDE'S MEMBERS NO ABILITY FACT DESCRIBES: the cards on the key by what they are
 *  (cast, enter, a keyword) rather than by an ability. A filter leaves them out because it cannot
 *  judge them, which is not the same as judging them and finding them short -- the page says so. */
export function unjudged(facts: readonly (readonly number[])[] | undefined): number {
  return (facts ?? []).filter((f) => f.length === 0).length;
}
