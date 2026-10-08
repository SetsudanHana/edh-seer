/** THE SAME JOB (#767, owner 2026-10-02): whether one card does what another does, read from their
 *  printed text and derived abilities before any measure compares them. Shared by the precon upgrade
 *  package's role sections (`upgrade-sections.ts`) and the report's same-job swaps
 *  (`suggest-static.ts`), so a swap the report offers and one the precon page offers obey one rule.
 *
 *  The seed of redundancy groups: cards that pass `sameJob` with each other do the same thing. */
import { grammarClauseRecords } from "@edh-seer/tagger/clause-record";
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

/** `triggers` false when the caller reads triggers itself (the group key does, from the grammar):
 *  printed, an upside's trigger (Mana Drain's "at the beginning of your next main phase") reads as a
 *  condition. */
export function newConditions(cut: DeckCard, add: DeckCard, triggers_ = true, tolerated: readonly string[] = []): boolean {
  const a = printed(add);
  const c = printed(cut);
  if (CONDITIONS.some((re) => !tolerated.includes(re.source) && re.test(a) && !re.test(c))) return true;
  if (REACH.some((re) => re.test(c) && !re.test(a))) return true;
  const cutStats = new Set(c.match(STAT_CLAUSE) ?? []);
  if ((a.match(STAT_CLAUSE) ?? []).some((x) => !cutStats.has(x))) return true;
  if (!triggers_) return false;
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

/** THE GROUP KEY (S-T2, docs/plans/2026-10-04-same-job-review.md): every part of the role abilities'
 *  reading that decides the job -- what it does, to whom and what (types as a conjunction, whose,
 *  one or all), which keywords, how long, how it is delivered, the shape of how much, what limits
 *  it, what it gives back -- and nothing the reading does not hold. Two cards do the same job when
 *  their keys are equal. `sameJob` is looser on the role parts (the add's may contain the cut's and
 *  more: "same with upside", owner 2026-10-06) and stricter on drawbacks and printed conditions, so
 *  neither test implies the other. Cost and the size of a fixed amount are left OUT of both.
 *
 *  NULL IS A REFUSAL, NOT A GUESS: no role ability, a keyword grant whose keywords were not read, or
 *  a creature (its body does other work no measure reads). A null key joins no group. */
export function groupKey(d: DeckCard, role: Role): string | null {
  return readJob(d, role)?.key ?? null;
}
/** For the purity instrument's diagnostics only. */
export const jobOf = (d: DeckCard, role: Role) => readJob(d, role);

/** WHICH OF A CARD'S ACTIONS ARE ITS ROLE, by the grammar's verbs (measured over the 69 labelled pairs'
 *  cards, 2026-10-06). The rest of the card is upside unless it is a drawback or a give-back, below:
 *  "same with upside" (owner, 2026-10-06) keeps Mana Drain with Counterspell and Harmonize with
 *  Ambition's Cost. */
const ROLE_VERBS: Partial<Record<Role, readonly string[]>> = {
  draw: ["draw"], impulseDraw: ["exile", "play", "cast"], tutor: ["search", "put"],
  targetedRemoval: ["destroy", "exile", "deal-damage", "modify-pt", "sacrifice"],
  boardWipe: ["destroy", "exile", "deal-damage", "modify-pt", "sacrifice"],
  stackInteraction: ["counter-spell", "counter-ability"], protection: ["grant-ability", "phase-out"],
  ramp: ["add-mana", "search", "put"], graveyardHate: ["exile"],
};
/** WHAT A REMOVAL SPELL HANDS ITS VICTIM: Beast Within's 3/3, Path's land, Swords' life. Two answers do
 *  the same job only if they hand back the same thing. */
const GIVE_BACK = new Set(["create", "search", "put", "gain-life", "cast"]);
const GIVES_BACK_ROLES: ReadonlySet<Role> = new Set(["targetedRemoval", "boardWipe"]);
/** WHAT IT COSTS YOU beyond mana: Bontu's lands that do not untap, Ambition's Cost's life. The add may
 *  carry no drawback the cut does not. */
const DRAWBACK = new Set(["lose-life", "sacrifice", "discard", "cant", "tap", "deal-damage"]);

interface Job { key: string; head: string; kind: string; parts: Set<string>; drawbacks: Set<string>; upsides: Set<string>; all: Set<string> }
/** ONE READING PER CARD AND ROLE: swap search asks about the same cards hundreds of times, and each
 *  reading runs the grammar over the printed text. Keyed on the DeckCard object, so a rebuilt card
 *  (a new analysis) is read afresh and nothing outlives it. */
const JOBS = new WeakMap<DeckCard, Map<Role, Job | null>>();
function readJob(d: DeckCard, role: Role): Job | null {
  let byRole = JOBS.get(d);
  if (!byRole) JOBS.set(d, (byRole = new Map()));
  if (!byRole.has(role)) byRole.set(role, readJobOnce(d, role));
  return byRole.get(role)!;
}
function readJobOnce(d: DeckCard, role: Role): Job | null {
  if (isCreature(d) || roleAbilities(d, role).length === 0) return null;
  // THE GRAMMAR'S READING, NOT THE STORED TAGS (spec F1): the tags keep `dies:any` for Day of
  // Judgment, Their Name Is Death, Damning Verdict and Bontu's Last Reckoning alike, and Nix's "if no
  // mana was spent" not at all. The reading holds each action's verb, its object with every limit,
  // and its condition. A card the grammar does not read completely joins no group.
  const verbs = ROLE_VERBS[role];
  if (!verbs) return null;
  // A CARD OF TWO FACES JOINS NO GROUP YET (review of #1048): the readings carry both faces' clauses,
  // and Fire // Ice or a land // creature would key on the two halves at once.
  if (d.card.name.includes(" // ") || (d.card.faces?.length ?? 0) > 1) return null;
  const g = grammarClauseRecords(d.card as never);
  if (!g.complete || !g.readings) return null;
  const job: string[] = [];
  const drawbacks = new Set<string>();
  const upsides = new Set<string>();
  const all = new Set<string>();
  for (const r of Object.values(g.readings)) {
    const roleClause = (r.actions ?? []).some((a) => verbs.includes(a.verb));
    // A ROLE ACTION'S TRIGGER IS PART OF ITS JOB: Moldervine Reclamation draws when a creature dies.
    if (roleClause && r.trigger?.length) job.push(`when ${JSON.stringify(r.trigger)}`);
    for (const a of r.actions ?? []) {
      // "CAN'T BE REGENERATED" IS NEITHER JOB, COST NOR UPSIDE: vestigial against today's cards (owner,
      // label p57: Wrath of God is Day of Judgment).
      if (a.verb === "cant" && /regenerat/i.test(`${(a as { text?: string }).text ?? ""} ${a.phrase ?? ""}`)) continue;
      // A GRANT'S KEYWORD IS ITS `text` ("hexproof", "haste"): the grammar reads it there (S-T1). A grant
      // whose ability was not read is not a job: Swiftfoot Boots and Commander's Plate would read alike.
      // A TYPE OR A COLOUR GRANT IS READ INTO `phrase` ("is every basic land type"), not `text`.
      const granted = a.verb === "grant-ability" ? ((a as { text?: string }).text ?? a.phrase)?.toLowerCase().trim() : undefined;
      if (a.verb === "grant-ability" && !granted) return null;
      const o = a.object as Record<string, unknown> | undefined;
      const giveBack = GIVES_BACK_ROLES.has(role) && GIVE_BACK.has(a.verb) && o?.control !== "you";
      // THE WHOLE ACTION, its words and its fixed size aside: how much is what an upgrade compares,
      // and a give-back token's creature type is cosmetic (Pongify's Ape, Rapid Hybridization's Frog
      // Lizard: both a 3/3 green token).
      const rest = Object.fromEntries(Object.entries(a as unknown as Record<string, unknown>)
        .filter(([k]) => !["text", "phrase", "object", "verb", "amount"].includes(k)));
      const obj = o ? { ...o, amount: undefined, count: undefined, ...(giveBack ? { subtype: undefined } : {}) } : undefined;
      const part = JSON.stringify([a.verb, canon(obj), canon(rest), amountShape(a.amount === undefined ? undefined : String(a.amount)), giveBack ? "" : objectWords(a.phrase), granted ?? ""]);
      all.add(part);
      // AIMED AT YOU, A ROLE VERB IS A COST (review of #1048): a wipe that also damages you, or makes
      // you sacrifice, carries that as a drawback, not as part of the job.
      const atYou = o?.control === "you" && DRAWBACK.has(a.verb);
      if (verbs.includes(a.verb) && !atYou) job.push(part);
      else if (giveBack) job.push(`gives ${part}`);
      // A CARD FROM YOUR HAND IS A COST TOO: Brainstorm puts two back, See Beyond shuffles one in.
      // "CAN'T" IS A COST ONLY WHEN IT BINDS YOU (Bontu's lands): Whispersilk Cloak's "can't be blocked"
      // is the card's upside, not a drawback (S-T3 census).
      else if ((DRAWBACK.has(a.verb) && o?.control !== "opp" && (a.verb !== "cant" || o?.control === "you")) || ((a.verb === "put" || a.verb === "shuffle") && (a as { fromZone?: string }).fromZone === "hand")) drawbacks.add(part);
      else upsides.add(part);
    }
  }
  if (job.length === 0) return null;
  const ramp = role === "ramp" ? [rampKind(d), [...(d.card.producedMana ?? [])].sort().join("")] : [];
  const head = JSON.stringify([role, delivery(d), ...ramp]);
  const kind = JSON.stringify([role, delivery(d), ...ramp.slice(0, 1)]);
  return { key: JSON.stringify([role, delivery(d), ...ramp, [...new Set(job)].sort()]), head, kind, parts: new Set(job), drawbacks, upsides, all };
}

/** The words of an object with its numbers taken out: "all nonartifact creatures" keeps "nonartifact"
 *  (which the object filter does not hold), "three cards" and "two cards" read alike, since how much
 *  is what an upgrade compares, not what the job is. */
function objectWords(phrase: string | undefined): string {
  // X STAYS X: -X/-X is not -1/-1 (Toxic Deluge is not Nausea); only a fixed count becomes "#".
  return (phrase ?? "").toLowerCase().replace(/\b(?:a|an|one|two|three|four|five|six|seven|\d+)\b/g, "#").replace(/\s+/g, " ").trim();
}

/** A subject as a stable string, every field it states and none it does not: "artifact creature" and
 *  "artifact or creature" are different objects, and so are "target" and "each". Nested objects (a
 *  token's stats, an actor) are read the same way; printed words (`text`) and back-references (`ref`)
 *  are not part of what something is, and an actor that is you is the default. */
function canon(s: Record<string, unknown> | undefined | null): string {
  return s ? JSON.stringify(stable(s)) : "";
}
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable).map((x) => JSON.stringify(x)).sort();
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o).filter((k) => k !== "text" && k !== "ref" && o[k] !== undefined && o[k] !== null)
      .filter((k) => !(k === "actor" && (o[k] as { control?: string }).control === "you"))
      .sort().map((k) => [k, stable(o[k])]);
  }
  return v;
}
/** The shape of an amount: a fixed number, X, or the expression itself ("for each opponent"). */
function amountShape(x: string | undefined): string {
  if (x === undefined) return "";
  const t = x.trim().toLowerCase();
  return /^\d+$/.test(t) ? "N" : t === "x" ? "X" : t;
}
/** How the card delivers the job: its card types, and an Equipment or an Aura apart. */
function delivery(d: DeckCard): string {
  const line = (d.card.typeLine ?? "").split("//")[0]!.toLowerCase();
  return [shape(d), /\bequipment\b/.test(line) ? "equipment" : "", /\baura\b/.test(line) ? "aura" : ""].filter(Boolean).join(" ");
}

/** THE SAME JOB: the group key (above), equal and readable on both sides. */
export function sameJob(cut: DeckCard, add: DeckCard, role: Role): boolean {
  const c = readJob(cut, role);
  const a = readJob(add, role);
  // THE ADD DOES EVERY PART OF THE CUT'S JOB, AND MAY DO MORE ("same with upside"): Unbreakable
  // Formation's vigilance on top of Flawless Maneuver's indestructible. Deliberately with no tie
  // between the shared part and the extra one (review of #1050): any extra role action is upside.
  if (!c || !a || c.head !== a.head || ![...c.parts].every((x) => a.parts.has(x))) return false;
  // ONE-DIRECTIONAL, so an upgrade that drops a drawback or a condition stays the same job: the add may
  // carry no drawback, and print no condition, the cut does not.
  // AND THE CUT'S UPSIDE IS KEPT: "same with upside" is the add having more, never the cut. Explore's
  // extra land is half the card, and Artifist Acumen's first strike does not replace it.
  return [...a.drawbacks].every((x) => c.drawbacks.has(x)) && [...c.upsides].every((x) => a.all.has(x)) && !newConditions(cut, add, false);
}

/** DAMAGE TO YOURSELF is the price of a Talisman's coloured mana, and "life is a resource" (owner,
 *  2026-10-08): on the add of a colour swap it blocks nothing. These are the two conditions that
 *  read it, so `newConditions` is told to let them by. */
const SELF_DAMAGE = [/\bdamage to you\b/.source, /\bdeals? (?:\d+|x) damage\b/.source];
const damagesOthers = (t: string) => /\bdeals? (?:\d+|x) damage to (?!you\b)/.test(t);

/** A ROCK THAT PRINTS MORE MANA THAN IT COSTS (Sol Ring, Mana Vault, Mana Crypt, Grim Monolith: owner
 *  2026-10-08): the printed yield is above the mana value. Never cut for the sake of a colour. */
export function netPositiveMana(d: DeckCard): boolean {
  const y = yieldOf(d, "ramp");
  return typeof y === "number" && y > (d.card.manaValue ?? 0);
}

/** THE SAME ROCK, ANY COLOURS (owner 2026-10-08, #966): `sameJob`'s ramp head holds the exact colour set
 *  and its parts hold the mana words, so no two rocks of different colours ever pass it. A colour swap
 *  needs the rest of the job alike and the colours free: both are rocks of one shape, the add does
 *  whatever else the cut does (its mana line aside), prints no drawback or condition the cut lacks bar
 *  damage to its own controller, and yields at least as much as printed. The cut's own upside (Mind
 *  Stone's draw) is not kept: an extra ability does not protect a source.
 *  CEILING: creatures (dorks) are out, as for `sameJob`: a body does other work no measure reads. */
export function sameRockAnyColour(cut: DeckCard, add: DeckCard): boolean {
  if (isCreature(cut) || isCreature(add)) return false;
  const c = readJob(cut, "ramp");
  const a = readJob(add, "ramp");
  if (!c || !a || c.kind !== a.kind || rampKind(cut) !== "rock") return false;
  const isMana = (x: string) => x.startsWith('["add-mana"');
  if (![...c.parts].filter((x) => !isMana(x)).every((x) => a.parts.has(x))) return false;
  if (![...a.parts].some(isMana)) return false;
  const selfDamage = (x: string) => x.startsWith('["deal-damage"') && !damagesOthers(printed(add));
  if (![...a.drawbacks].every((x) => c.drawbacks.has(x) || selfDamage(x))) return false;
  if (newConditions(cut, add, false, damagesOthers(printed(add)) ? [] : SELF_DAMAGE)) return false;
  const cy = yieldOf(cut, "ramp");
  const ay = yieldOf(add, "ramp");
  return typeof cy === "number" && typeof ay === "number" && ay >= cy;
}

/** THE OLD TEST, KEPT ONLY FOR THE BEFORE NUMBER while S-T2 is measured; not called by the product. */
export function sameJobByRules(cut: DeckCard, add: DeckCard, role: Role): boolean {
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

/** THE SAME GROUP (#976): what a Game Changer upgrade asks, looser than `sameJob`. A Game Changer is on
 *  the list for being among the strongest cards at its job, and most are strong through a condition
 *  `sameJob` refuses: Mana Vault does not untap, Mox Diamond discards a land, Smothering Tithe works
 *  "unless that player pays" (2026-10-03: no Game Changer passed `sameJob` for any card in 20
 *  precons). So shape, conditions and amount are left out; the kind of job is kept: the same kind of
 *  ramp, an answer that hits what the cut hits, or every effect the cut has. */
/** RAMP THAT GIVES A LAND BACK IS NOT RAMP: Crop Rotation sacrifices a land to fetch one, no mana
 *  gained, and the first full build offered it for Cultivate and Harrow 90 times (2026-10-03). */
const SACRIFICES_A_LAND = /\bsacrifices? an? (?:untapped )?land\b/;
export function sameGroup(cut: DeckCard, add: DeckCard, role: Role): boolean {
  if (isCreature(cut) || isCreature(add)) return false;
  if (role === "ramp") return rampKind(cut) !== "" && rampKind(cut) === rampKind(add) && !(SACRIFICES_A_LAND.test(printed(add)) && !SACRIFICES_A_LAND.test(printed(cut)));
  if (ANSWER_ROLES.has(role)) return answerCovers(subjects(cut, role), subjects(add, role));
  const theirs = effectsOf(add, role);
  return [...effectsOf(cut, role)].every((e) => theirs.has(e));
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
