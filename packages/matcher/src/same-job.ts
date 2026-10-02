/** THE SAME JOB (#767, owner 2026-10-02): whether one card does what another does, read from their
 *  printed text and derived abilities before any measure compares them. Shared by the precon upgrade
 *  package's role sections (`upgrade-sections.ts`) and the report's same-job swaps
 *  (`suggest-static.ts`), so a swap the report offers and one the precon page offers obey one rule.
 *
 *  The seed of redundancy groups: cards that pass `sameJob` with each other do the same thing. */
import { detectBuildRules } from "./build.js";
import { roleAbilities, type Role } from "./quality.js";
import type { DeckCard } from "./types.js";

/** THE SAME KIND OF CARD: the same card types on its front face, supertypes and Kindred aside. */
const SHAPE_TYPES = ["artifact", "battle", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery"];
export function shape(d: DeckCard): string {
  const front = (d.card.typeLine ?? "").split("//")[0]!.split(/[—-]/)[0]!.toLowerCase();
  return SHAPE_TYPES.filter((t) => new RegExp(`\\b${t}\\b`).test(front)).join(" ");
}
export const isCreature = (d: DeckCard) => shape(d).split(" ").includes("creature");

/** CONDITIONS THE MEASURES DO NOT SEE. A card that asks for something before it does its job, or
 *  hands something back, is not the same card as one that just does it, and derive can miss the
 *  condition (Isolate's "with mana value 1", 2026-09-30). The add may print no condition the cut does
 *  not print too. Reminder text is not read. */
export const CONDITIONS: readonly RegExp[] = [
  /\blegendary\b/, /\bonly (?:if|during|as|once)\b/, /\bequip(?:ped)?\b/, /\benchanted\b/, /\battack(?:s|ed|ing)?\b/,
  /\bblock(?:s|ed|ing)?\b/, /\bif you control\b/, /\bunless\b/, /\bas an additional cost\b/, /\bsacrifice\b/, /\bdiscard\b/,
  /\bpay \d+ life\b/, /\bfrom your graveyard\b/, /\bchooses?\b/, /\bvot(?:e|ing)\b/,
  /\bdealt damage\b/, /\bwhere x is\b/, /\benters tapped\b/, /\{e\}/, /\bits owner may\b/, /\bmore to cast\b/,
  /\byou lose\b/, /\bif you don['’]t\b/, /\bhalf your life\b/, /\bopponents? gains?\b/, /\bremove\b/, /\bgains? control\b/,
  /\bsacrifice an? (?:untapped )?(?:island|swamp|plains|mountain|forest|land)\b/, /\b(?:un)?tapped (?:creature|artifact|permanent)\b/,
  // DAMAGE AND -N/-N ARE CAPPED BY TOUGHNESS: Flame-Blessed Bolt is not Swords to Plowshares.
  /\bdeals? (?:\d+|x) damage\b/, /\bgets? [-−](?:\d+|x)\/[-−](?:\d+|x)\b/,
  /\bkick(?:er|ed)\b/, /\bmultikicker\b/, /\bsuspend\b/, /\btime counters?\b/, /\breturn (?:it|that card|the exiled card)\b/,
  /\bany player may\b/, /\bmay have\b/, /\bdoesn['’]t untap\b/, /\bdamage to you\b/, /\bcounters?\b/, /\bsnow\b/,
  // A TARGET IS NARROWER THAN NONE: "creatures you control gain indestructible" is not "target creature".
  /\btarget\b/,
  // ONE COLOUR WORD EACH, so Crib Swap's "colorless" token does not excuse Celestial Purge's "black or red".
  ...["white", "blue", "black", "red", "green", "multicolou?red", "monocolou?red", "colou?rless", "non(?:white|blue|black|red|green)"].map((w) => new RegExp(`\\b${w}\\b`)),
  // AN ABILITY WORD opens a condition ("Undergrowth —", "Delirium —").
  /^(?:[a-z]+ )*[a-z]+ — /m,
];
/** REACH THE CUT HAS AND THE ADD MUST KEEP: a spell for your whole team is not one for a single
 *  creature, and one of each type is not one. */
const REACH: readonly RegExp[] = [/\bcreatures you control\b/, /\bpermanents you control\b/, /\beach (?:creature|opponent|player)\b/,
  /\ball (?:creatures|permanents)\b/, /\bof each\b/, /\bup to (?:two|three|four)\b/, /\bone or more\b/,
  /\b(?:one other|another) target\b/];
/** A TRIGGER WAITS FOR SOMETHING, and the add must wait for the same thing: Moldervine Reclamation
 *  draws when a creature dies, Season of Growth when you target your own creature. The card's own
 *  name reads as "~", so two cards' "when this enters" match. */
const TRIGGER = /\b(?:whenever|when|at the beginning of) [^,.]*/g;
function triggers(d: DeckCard): Set<string> {
  const own = [d.card.name, d.card.name.split(" // ")[0]!, d.card.name.split(",")[0]!].map((n) => n.toLowerCase());
  let t = printed(d);
  for (const n of own) t = t.split(n).join("~");
  t = t.replace(/\bthis (?:artifact|enchantment|creature|land|spell|card)\b/g, "~");
  return new Set(t.match(TRIGGER) ?? []);
}
/** A STAT LIMIT MUST BE THE SAME LIMIT: Despark's "with mana value 4 or greater" and Isolate's "with
 *  mana value 1" both print the phrase, and are opposite cards. */
const STAT_CLAUSE = /\bwith (?:mana value|power|toughness)[^.,;]*/g;
/** REMINDER TEXT, one parenthesis at a time: "[^()]" stops at the next "(", so a run of unclosed ones
 *  is read once, not once per "(" (CodeQL, 2026-09-30). */
const REMINDER = /\([^()]*\)/g;
const printed = (d: DeckCard) => (d.card.oracleText ?? "").replace(REMINDER, "").toLowerCase();

export function newConditions(cut: DeckCard, add: DeckCard): boolean {
  const a = printed(add);
  const c = printed(cut);
  if (CONDITIONS.some((re) => re.test(a) && !re.test(c))) return true;
  if (REACH.some((re) => re.test(c) && !re.test(a))) return true;
  const cutStats = new Set(c.match(STAT_CLAUSE) ?? []);
  if ((a.match(STAT_CLAUSE) ?? []).some((x) => !cutStats.has(x))) return true;
  const cutTriggers = triggers(cut);
  return [...triggers(add)].some((x) => !cutTriggers.has(x));
}

const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
/** HOW MUCH IT DOES, AS PRINTED: the most cards a draw line names, the most mana an "add" names, the
 *  most lands a search names. `x` when the amount is variable. The rate measures are per mana, so
 *  without this Insist (draw one for one) beat Ambition's Cost (draw three for four). */
function yieldOf(d: DeckCard, role: Role): number | "x" | null {
  const t = printed(d);
  if (role === "draw") {
    const m = [...t.matchAll(/\bdraws? (a|an|one|two|three|four|five|six|seven|x) cards?\b/g)].map((x) => x[1]!);
    if (m.includes("x")) return "x";
    return m.length ? Math.max(...m.map((w) => NUMBER[w] ?? 0)) : null;
  }
  if (role === "ramp") {
    const adds = [...t.matchAll(/\badd ((?:\{[^}]+\})+)/g)].map((x) => (x[1]!.match(/\{/g) ?? []).length);
    const lands = [...t.matchAll(/\bsearch your library for up to (two|three|four) basic land/g)].map((x) => NUMBER[x[1]!] ?? 1);
    const all = [...adds, ...lands, ...(/\bsearch your library for an? basic land/.test(t) ? [1] : [])];
    return all.length ? Math.max(...all) : null;
  }
  return null;
}
/** A land fetcher, a rock, or neither: the same job for ramp is the same kind of ramp. */
function rampKind(d: DeckCard): string {
  const rules = [...detectBuildRules([d]).keys()];
  return rules.some((r) => r.startsWith("ramp.land")) ? "land" : rules.some((r) => r.startsWith("ramp.")) ? "rock" : "";
}

const PERMANENT_TYPES = ["artifact", "battle", "creature", "enchantment", "land", "planeswalker"];
const ANSWER_ROLES: ReadonlySet<Role> = new Set(["targetedRemoval", "stackInteraction", "boardWipe", "graveyardHate"]);
/** LIMITS ON WHAT AN ANSWER MAY TARGET, as the tags record them: Thraben Exorcism's Spirit and disturb. */
const LIMITS = ["subtype", "keyword", "colors", "stats", "legendary", "supertype", "named"] as const;
function subjects(d: DeckCard, role: Role): Subject[] {
  return roleAbilities(d, role).flatMap((a) => (a.emits ?? []).filter((e) => e.subject.control !== "you").map((e) => e.subject as unknown as Subject));
}
type Subject = Record<string, unknown>;
/** What an answer hits, as card types. */
function hits(subjects: readonly Subject[]): Set<string> {
  const out = new Set<string>();
  for (const s of subjects) {
    const not = new Set([s.notType ?? []].flat().map((t) => String(t).toLowerCase()));
    for (const t of [s.type ?? []].flat().map((x) => String(x).toLowerCase())) {
      for (const x of t === "permanent" ? PERMANENT_TYPES : [t]) if (!not.has(x)) out.add(x);
    }
  }
  return out;
}
const limits = (subjects: readonly Subject[]) => new Set(subjects.flatMap((s) => LIMITS.filter((k) => s[k] !== undefined && s[k] !== null)));
/** AN ANSWER THAT DOES THE CUT'S JOB: it hits every card type the cut hits, with no limit the cut
 *  lacks (Erase and Thraben Exorcism are not Crib Swap). */
export function answerCovers(cut: readonly Subject[], add: readonly Subject[]): boolean {
  const theirs = hits(add);
  if (![...hits(cut)].every((t) => theirs.has(t))) return false;
  const cutLimits = limits(cut);
  return [...limits(add)].every((k) => cutLimits.has(k));
}

/** THE SAME JOB, before any measure is read. */
export function sameJob(cut: DeckCard, add: DeckCard, role: Role): boolean {
  // A CREATURE'S BODY IS DOING OTHER WORK (a tribe, a blocker, a sacrifice), and no measure here
  // reads it, so creatures are never swapped as role cards.
  if (isCreature(cut) || isCreature(add)) return false;
  if (shape(cut) !== shape(add)) return false;
  if (newConditions(cut, add)) return false;
  const c = yieldOf(cut, role);
  const a = yieldOf(add, role);
  if (c === "x" && a !== "x") return false;
  if (typeof c === "number" && (a === null || (typeof a === "number" && a < c))) return false;
  if (role === "ramp") {
    if (rampKind(cut) !== rampKind(add)) return false;
    const made = new Set(add.card.producedMana ?? []);
    if (!(cut.card.producedMana ?? []).every((x) => made.has(x))) return false;
  }
  if (ANSWER_ROLES.has(role) && !answerCovers(subjects(cut, role), subjects(add, role))) return false;
  // EVERY OTHER ROLE: the add does each thing the cut's role ability does, to the same side. The role
  // label is not enough: Teferi's Reproach (an opponent's permanents phase out) and Blossoming Calm
  // (you gain hexproof) are both `protection` (owner, 2026-10-02). Answers have `answerCovers`, and
  // ramp its own kind and colours above.
  if (!ANSWER_ROLES.has(role) && role !== "ramp") {
    const theirs = effectsOf(add, role);
    if (![...effectsOf(cut, role)].every((e) => theirs.has(e))) return false;
  }
  return true;
}

/** WHAT A ROLE ABILITY DOES: its effect kind, and each event it causes with whose it is
 *  ("keyword-grant", "|phases-out|opp", "draw-card|draw|you"). Protection adds what it protects. */
export function effectsOf(d: DeckCard, role: Role): Set<string> {
  const out = new Set(roleAbilities(d, role).flatMap((a) => {
    const kind = a.effect?.kind ?? "";
    const emits = (a.emits ?? []).map((e) => `${kind}|${e.verb}|${e.subject.control ?? ""}`);
    return emits.length > 0 ? emits : [kind];
  }));
  if (role === "protection") for (const r of protects(d)) out.add(`protects|${r}`);
  return out;
}

/** WHAT A PROTECTION SPELL PROTECTS, off the printed text: you, or your permanents. A keyword grant
 *  is derived with neither the keyword nor its recipient (`control: "any"`), so Blossoming Calm ("you
 *  gain hexproof") read as Heroic Intervention ("permanents you control gain hexproof"). CEILING: a
 *  stopgap until the card grammar's typed actions carry the recipient (#896). */
function protects(d: DeckCard): Set<string> {
  const t = (d.card.oracleText ?? "").replace(REMINDER, "");
  const out = new Set<string>();
  if (/\byou (?:gain|have) (?:hexproof|shroud|protection)\b|\bplayers? (?:gains?|have) (?:hexproof|shroud|protection)\b/i.test(t)) out.add("you");
  if (/\b(?:permanents?|creatures?|artifacts?|enchantments?|planeswalkers?)\b[^.]*\b(?:gains?|gets?|have|has)\b[^.]*\b(?:hexproof|shroud|indestructible|protection|phases? out)\b/i.test(t)) out.add("permanents");
  return out;
}
