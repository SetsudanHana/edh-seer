import type { Ability, CardTags, SubjectFilter } from "@edh-seer/tagger";

/** A WHOLE-CLASS BASE POWER AND TOUGHNESS SET (CR 613.4b: layer 7b sets power and/or toughness; #1572, owner ruling 2026-11-08). Graaz ("other creatures you control have base power and toughness 5/3"), March of the World Ooze (6/6),
 *  Kudo (2/2), Raised by Giants (10/10). It pairs with what it UPGRADES -- a token maker whose token is smaller than the set value, a creature whose printed power is smaller -- and with the "power matters" payoffs
 *  that read power across the board (Molten Monstrosity's "greatest power among creatures you control", a "creature with power 4 or greater" trigger or condition, ferocious, formidable). It is not an anthem:
 *  a creature already at or above the set value, and a card that is neither maker nor payoff, have no pair.
 *  The set value is `Ability.amount` ("5/3", "base 1/1"). Linear string reads only: the oracle text of a card reaches this from exports. */

/** The set power and toughness of a `base-pt-set` ability, undefined when `amount` is not a printed pair of numbers. */
export function baseSetValue(amount: string | undefined): { power: number; toughness: number } | undefined {
  let t = (amount ?? "").trim().toLowerCase();
  if (t.startsWith("base ")) t = t.slice(5);
  const slash = t.indexOf("/");
  if (slash < 1) return undefined;
  const power = num(t.slice(0, slash)), toughness = num(t.slice(slash + 1));
  return power === undefined || toughness === undefined ? undefined : { power, toughness };
}

/** A printed or stored number: digits only ("*", "1+*" and "X" are none). */
function num(s: string | null | undefined): number | undefined {
  if (s === null || s === undefined || s.length === 0 || s.length > 3) return undefined;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 48 || c > 57) return undefined; }
  return Number(s);
}

/** The printed base power of a card's characteristics (a token node's included), undefined for a variable or absent power. */
export const printedPower = (tags: CardTags): number | undefined => num(tags.characteristics.power);

/** Is this ability a base set that pairs at all? A 1/1 set is a hose (Humility, Godhead of Awe), a set beside "lose all abilities" over the same class is removal, not an upgrade (Humility, Sludge Monster, Poppet Factory), and an Aura's set lands on the player it enchants.
 *  CEILING: the floor is a set power below 2; a 1/1 set still upgrades a power-0 body (a Wall, a 0/1 token), which is not read. */
export function pairsAsUpgrade(p: CardTags, a: Ability): { power: number; toughness: number } | undefined {
  const v = baseSetValue(a.amount);
  if (v === undefined || v.power < 2) return undefined;
  if (p.abilities.some((x) => x.clause === a.clause && x.effect.kind === "ability-loss")) return undefined;
  // An Aura's class set is aimed at the player it enchants ("creatures enchanted player controls": Curse of Conformity, Overwhelming Splendor), derive keeps only `control: any`.
  if (p.characteristics.subtypes?.includes("aura") === true) return undefined;
  return v;
}

/** The floor of a base-P/T pair's strength (owner ruling 2026-11-09, #1572). */
export const BASE_SET_FLOOR = 0.15;

/** HOW MUCH A SET OF `setPower` UPGRADES A BODY OF `power` (owner ruling 2026-11-09): max(0.15, (setPower - power) / setPower). Under a 6/6 set a 1/1 is 0.83, a 3/3 0.50, a 5/5 0.17. Rounded to 3 places so the stored figure is stable. */
export function baseSetStrength(setPower: number, power: number): number {
  return Math.round(Math.max(BASE_SET_FLOOR, (setPower - power) / setPower) * 1000) / 1000;
}

/** The creature token a maker's emit creates that the set raises: its stored base power is below the set power, or its base toughness below the set toughness, with the strength of the pair: the curve at the token's base power,
 *  the floor for a token whose only shortfall is toughness, and the best of a maker's several shapes. Undefined when it raises none. */
export function raisedToken(c: CardTags, v: { power: number; toughness: number }, inClass: (shape: SubjectFilter) => boolean): { shape: SubjectFilter; strength: number } | undefined {
  let best: { shape: SubjectFilter; strength: number } | undefined;
  for (const a of c.abilities) {
    for (const e of a.emits ?? []) {
      const s = e.subject;
      if (e.verb !== "create-token" || s.control === "opp" || !(Array.isArray(s.type) ? s.type : [s.type]).includes("creature")) continue;
      const power = s.stats?.find((x) => x.metric === "power" && x.op === "eq")?.value;
      const toughness = s.stats?.find((x) => x.metric === "toughness" && x.op === "eq")?.value;
      if (((power !== undefined && power < v.power) || (toughness !== undefined && toughness < v.toughness)) && inClass(s)) {
        const strength = power !== undefined && power < v.power ? baseSetStrength(v.power, power) : BASE_SET_FLOOR;
        if (best === undefined || strength > best.strength) best = { shape: s, strength };
      }
    }
  }
  return best;
}

/** What a card's POWER READING needs of the board: `0` reads power without a threshold ("the greatest power among creatures you control", "total power"), N a "power N or greater" a set power must reach. */
type PowerNeed = number;

/** Does the card read the POWER of the creatures you control, so that a set power helps it (the "power matters" payoffs)?
 *  Derived data first: a control gate with `minPower` (Temur Battle Rage's ferocious), a trigger / threshold / count over "power N or greater", an amount that is the greatest or total power of your creatures.
 *  Then the printed words, because derive stores no ability for a cost reducer or a condition of this shape (Molten Monstrosity, Heir of the Wilds, Crater Elemental's formidable): a sentence naming "greatest power among" or
 *  "total power" beside "you control", or "power N or greater" beside "you control", with no target and no opponent in it.
 *  CEILING: a power payoff worded another way ("each creature you control with power greater than its base power", "equal to its power") is not read; a threshold above the set power does not pair (Kudo's 2/2 x a power-4 trigger).
 *  CEILING: the printed reading is per sentence, so "creatures you control have total power 8 or greater" counts as a need of 0 (any set power helps a total) rather than as 8; a crew, saddle, station or teamwork cost is not a power payoff. */
export function powerNeeds(card: { oracleText?: string }, tags: CardTags): PowerNeed[] {
  const out: PowerNeed[] = [];
  const stat = (s: SubjectFilter | undefined): void => {
    if (s === undefined || s.self === true || s.control === "opp") return;
    for (const x of s.stats ?? []) if (x.metric === "power" && x.value !== undefined && (x.op === "gte" || x.op === "gt")) out.push(x.op === "gt" ? x.value + 1 : x.value);
  };
  for (const a of tags.abilities) {
    if (a.gate?.kind === "control" && a.gate.minPower !== undefined) out.push(a.gate.minPower);
    stat(a.trigger?.subject); stat(a.thresholdSubject); stat(a.effect.scalingSubject);
    const amount = (a.amount ?? "").toLowerCase();
    if ((amount.includes("greatest power") || amount.includes("total power")) && amount.includes("you control") && !amount.includes("opponent")) out.push(0);
  }
  for (const raw of withoutParentheses((card.oracleText ?? "").toLowerCase()).split(/[.\n]/)) {
    if (raw.length === 0 || raw.includes("target") || raw.includes("opponent")) continue;
    // A crew, saddle, station or teamwork COST taps creatures "with total power N or more": a way to pay, not a payoff that reads power (Sleek Schooner's Crew 1 is met by any creature).
    if (raw.includes("crew ") || raw.includes("saddle ") || raw.includes("station") || raw.includes("teamwork") || raw.includes("tap any number of")) continue;
    const yours = raw.includes("you control");
    if (!yours) continue;
    if (raw.includes("greatest power among") || raw.includes("total power")) out.push(0);
    for (let at = raw.indexOf("power "); at >= 0; at = raw.indexOf("power ", at + 6)) {
      let end = at + 6;
      while (end < raw.length && raw.charCodeAt(end) >= 48 && raw.charCodeAt(end) <= 57) end++;
      const n = num(raw.slice(at + 6, end));
      if (n !== undefined && (raw.startsWith(" or greater", end) || raw.startsWith(" or more", end))) out.push(n);
    }
  }
  return out;
}

/** The set power from which a reading WITHOUT a threshold ("the greatest power among creatures you control", "total power") is helped: 4, the bar the printed thresholds themselves use (ferocious, "power 4 or greater").
 *  CEILING: a set below it (Kudo's 2/2, Harmonious Archon's 3/3) shrinks the boards those readings want, so it pairs with the readings that name a threshold it meets and with no other. */
export const OPEN_READING_FLOOR = 4;

/** Does a set power of `power` satisfy one of the card's power readings? */
export const readsPower = (needs: PowerNeed[], power: number): boolean => needs.some((n) => power >= (n === 0 ? OPEN_READING_FLOOR : n));

/** The text with every parenthesised run removed (reminder text, a token's quoted rules reminder), in one linear pass; an unclosed run is dropped to the end. */
function withoutParentheses(text: string): string {
  let depth = 0, out = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") { if (depth > 0) depth--; }
    else if (depth === 0) out += ch;
  }
  return out;
}
