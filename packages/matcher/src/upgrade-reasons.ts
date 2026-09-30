/** THE PACKAGE'S REASONS, BOTH SIDES (#767, task 5). Every swap says why the card goes and why its
 *  replacement comes in, in a player's words (`packages/web/DESIGN.md`, "Words"): what the add does
 *  better, as the measures that made it strictly better; what the cut does worse, as the same facts
 *  seen from its side. No sentence claims more than the comparison checked.
 *
 *  THE VOCABULARY CEILING IS THE PRECON SEAT'S: it does not know "tutor", "Game Changer" unexplained,
 *  or "ETB". Ramp, removal, card draw and bracket are fine (DESIGN.md). */
import type { BringDownCut } from "./bracket-guard.js";
import type { Ingredient, Role } from "./quality.js";
import type { LandOption, RoleOption } from "./upgrade-sections.js";
import type { BracketTarget } from "./upgrade-package.js";

/** At most this long on either side (H2, pre-registered). */
export const REASON_MAX = 160;

const JOB: Record<Role, string> = {
  ramp: "ramp", draw: "card draw", cardSelection: "card selection", impulseDraw: "card draw", tutor: "card search",
  targetedRemoval: "removal", stackInteraction: "counterspell", boardWipe: "board wipe", burn: "damage", stax: "lock piece",
  protection: "protection", graveyardHate: "graveyard hate",
};
export const jobOf = (role: Role): string => JOB[role];
const YIELD_NOUN: Partial<Record<Role, string>> = { ramp: "mana", draw: "cards", impulseDraw: "cards", tutor: "cards found" };
const COLOUR: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** Keep a sentence under the limit by dropping trailing clauses, never mid-word. */
function fit(head: string, clauses: readonly string[], tail = "."): string {
  if (clauses.length === 0 && `${head}${tail}`.length <= REASON_MAX) return `${head}${tail}`;
  for (let n = clauses.length; n >= 1; n--) {
    const s = `${head}${list(clauses.slice(0, n))}${tail}`;
    if (s.length <= REASON_MAX) return s;
  }
  return `${head}${clauses[0] ?? ""}`.slice(0, REASON_MAX - 1).replace(/\s+\S*$/, "") + tail;
}

const permanence = (p: number | undefined) =>
  p === 3 ? "exiles it" : p === 0 ? "shuffles it away" : p === 2 ? "destroys it" : p === 1 ? "sends it back to hand" : "deals with it";

/** What the add gains, one clause per measure. */
function gains(o: RoleOption): string[] {
  const c = o.cut;
  const a = o.addIngredients;
  const out: string[] = [];
  for (const k of o.gained as Ingredient[]) {
    if (k === "manaValue") out.push(`for ${(c.manaValue ?? 0) - (a.manaValue ?? 0)} less mana`);
    else if (k === "timing") out.push(a.timing === 2 ? "at instant speed" : "without waiting for a sorcery window");
    else if (k === "frequency") out.push((c.frequency ?? 0) === 0 ? "again and again, not once" : "more often");
    else if (k === "rateFloor" || k === "rateCeiling") { const n = YIELD_NOUN[o.role]; if (n && !out.includes(`with more ${n} for the mana`)) out.push(`with more ${n} for the mana`); }
    else if (k === "breadth") out.push("against more kinds of card");
    else if (k === "permanence") out.push(permanence(a.permanence));
    else if (k === "oneSided") out.push("spares your own creatures");
    else if (k === "drawback") out.push("gives the opponent nothing back");
    else if (k === "restriction") out.push("makes mana you can spend on anything");
  }
  return out;
}
/** The same facts from the cut's side. */
function shortfalls(o: RoleOption, addName: string): string[] {
  const c = o.cut;
  const a = o.addIngredients;
  const out: string[] = [];
  for (const k of o.gained as Ingredient[]) {
    if (k === "manaValue") out.push(`costs ${c.manaValue} where ${addName} costs ${a.manaValue}`);
    else if (k === "timing") out.push(c.timing === 0 ? "waits for your own turn" : "can't be used at instant speed");
    else if (k === "frequency") out.push((c.frequency ?? 0) === 0 ? "works once" : "works less often");
    else if (k === "rateFloor" || k === "rateCeiling") { const n = YIELD_NOUN[o.role]; if (n && !out.includes(`gets fewer ${n} for the mana`)) out.push(`gets fewer ${n} for the mana`); }
    else if (k === "breadth") out.push("hits fewer kinds of card");
    else if (k === "permanence") out.push(`only ${permanence(c.permanence)}`);
    else if (k === "oneSided") out.push("hits your creatures too");
    else if (k === "drawback") out.push("gives the opponent something back");
    else if (k === "restriction") out.push("makes mana you can't spend on everything");
  }
  return out;
}

export function roleReasons(cutName: string, o: RoleOption): { out: string; in: string } {
  return {
    out: fit(`${cutName} `, shortfalls(o, o.add)),
    in: fit(`${o.add} is the same ${JOB[o.role]} `, gains(o)),
  };
}

const tappedWords = (t: number) => (t === 2 ? "enters tapped" : t === 1 ? "can enter tapped" : "enters untapped");
const colourWords = (cs: readonly string[]) => (cs.length ? list(cs.map((c) => COLOUR[c] ?? c)).replace(/ and ([a-z]+)$/, " or $1") : "no colour your spells use");

export function landReasons(o: LandOption): { out: string; in: string } {
  const outBits = [o.untapped ? tappedWords(o.cut.tapped) : "", o.colours.length ? `makes only ${colourWords(o.cut.colours)}` : ""].filter(Boolean);
  const inBits = [
    o.addFacts.tapped === 0 ? "never enters tapped" : o.untapped ? "enters tapped less often" : tappedWords(o.addFacts.tapped),
    `makes ${colourWords(o.addFacts.colours)}`,
  ];
  return { out: fit(`${o.cut.name} `, outBits), in: fit(`${o.add} `, inBits) };
}

/** A synergy pair: the cut's link count against the add's, and the engine's own sentence for the add. */
export function synergyReasons(cut: { name: string; connections: number }, add: { name: string; connections: number; reason: string }): { out: string; in: string } {
  const out = `${cut.name} works with ${plural(cut.connections, "card")} in this deck; ${add.name} works with ${add.connections}.`;
  return { out: out.length <= REASON_MAX ? out : `${cut.name} works with ${plural(cut.connections, "card")} in this deck.`, in: add.reason.length <= REASON_MAX ? add.reason : fit(`${add.name} `, [`works with ${plural(add.connections, "card")} in this deck`]) };
}

/** Why a card goes to bring the deck down, in the bracket's own terms, with "Game Changer" said as
 *  what it is: a card on the official list that raises a deck's bracket. */
export function bringDownReason(c: BringDownCut, target: BracketTarget): string {
  if (c.why.kind === "game-changer") {
    const allows = c.why.limit === 0 ? "allows none" : `allows ${c.why.limit}`;
    return fit(`${c.name} is on the official Game Changer list, which raises a deck's bracket; bracket ${target} ${allows}`, [], `, and this deck has ${c.why.count}.`);
  }
  return fit(`With ${list(c.why.with)}, ${c.name} makes an infinite combo`, [], `, which bracket ${target} doesn't allow.`);
}
/** Why its replacement comes in: the same job without what raised the bracket. */
export function bringDownInReason(add: string, cut: BringDownCut, job: string | null): string {
  const without = cut.why.kind === "game-changer" ? "without being a Game Changer" : "without the combo";
  return fit(`${add} `, [job ? `does the same ${job} as ${cut.name}, ${without}` : `takes the slot ${without}`]);
}
