/** THE CANDIDATE SWAPS FOR EACH ROLE SECTION (#767, task 4): for every card a section may cut, the
 *  cards that are strictly better at its job, ranked. The gatherer (task 6) takes from these lists
 *  in order and skips what its bracket guard refuses, so every option is kept, not only the first.
 *
 *  STRICTLY BETTER, NOT "BETTER" (owner, 2026-09-30). Two cards doing the same job are compared on
 *  the measures `quality.ts` reads, each with a known direction. The add must be at least as good on
 *  every measure both carry, in every role the cut fills, and better on at least one. No weights, no
 *  popularity, and the quality percentile `q` is not read. What the add gains is kept, so the reason
 *  can say it.
 *
 *  THE SAME JOB COMES FIRST, AND IT IS NARROW ON PURPOSE. The measures are coarse (#698), and a
 *  strict comparison over coarse measures finds the card whose drawback the measures do not see:
 *  run over six precons on 2026-09-30 it offered Mox Amber for Sol Ring, a planeswalker for
 *  Unbreakable Formation and Boomerang for Chaos Warp. So before any measure is read, the two cards
 *  must be the same kind of card, the add may print no condition the cut does not, an answer must hit
 *  every card type the cut hits with no limit the cut lacks, and the add must yield at least as much.
 *  A swap this refuses is a swap a player can still find; a swap it lets through is on the page. */
import { normalizeName } from "@edh-seer/data/names";
import { detectBuildRules, type BuildCategory } from "./build.js";
import { basicsFloor, betterLand, landFacts, neededColours, unusualText, type LandFacts } from "./land-score.js";
import { ingredients, roleAbilities, rolesOfCard, type Ingredient, type Ingredients, type Role } from "./quality.js";
import type { StaticLookup } from "./static-lookup.js";
import { candidatePool, type IndexCard } from "./suggest.js";
import { decodeIndex, deckCards } from "./suggest-static.js";
import type { DeckCard } from "./types.js";
import type { UpgradeSectionId } from "./upgrade-package.js";

export type RoleSectionId = Exclude<UpgradeSectionId, "lands" | "synergy">;

/** Each section's build categories, as the report groups them (`BUILD_PARENTS`). Burn and stax are
 *  in no section: neither is a job a precon is short of. */
export const SECTION_ROLES: Record<RoleSectionId, readonly Role[]> = {
  ramp: ["ramp"],
  consistency: ["draw", "cardSelection", "impulseDraw", "tutor"],
  interaction: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"],
  wipes: ["boardWipe"],
};
export const ROLE_SECTIONS = Object.keys(SECTION_ROLES) as RoleSectionId[];

/** THE DIRECTION OF EACH MEASURE: lower is better for these, higher for the rest. */
const LOWER_IS_BETTER: ReadonlySet<Ingredient> = new Set(["manaValue", "drawback", "restriction"]);
/** NOT A GAIN ON ITS OWN: derive splits one printed ability into two often enough (Oblivion Ring's
 *  two triggers against Banishing Light's) that a second ability is no evidence of a better card.
 *  Still never allowed to get worse. */
const NOT_A_GAIN: ReadonlySet<Ingredient> = new Set(["extraValue"]);

/** A SHUFFLE IS NOT ON THE SAME LADDER. `quality.ts` ranks a tuck below a bounce (0 against 1), which
 *  made Boomerang "better" than Chaos Warp; a player ranks it near exile. The pre-registered measure
 *  (H4) reads `quality.ts`'s order as it stands, so rather than reorder it here, a tuck is compared
 *  only with another tuck: Chaos Warp is never offered for a destroy spell, and nothing replaces it. */
function tuckMismatch(cut: Ingredients, add: Ingredients): boolean {
  return cut.permanence !== undefined && add.permanence !== undefined && (cut.permanence === 0) !== (add.permanence === 0);
}

/** STRICTLY BETTER on one role's measures: `null` when worse on any, or when the pair cannot be
 *  compared (either lacks mana value or timing, or the cut carries a measure the add does not). */
export function strictlyBetter(cut: Ingredients, add: Ingredients): Ingredient[] | null {
  if (tuckMismatch(cut, add)) return null;
  if (cut.manaValue === undefined || cut.timing === undefined || add.manaValue === undefined || add.timing === undefined) return null;
  const gained: Ingredient[] = [];
  for (const k of Object.keys(cut) as Ingredient[]) {
    const c = cut[k];
    const a = add[k];
    if (c === undefined) continue;
    if (a === undefined) return null;
    if (LOWER_IS_BETTER.has(k) ? a > c : a < c) return null;
    if (a !== c && !NOT_A_GAIN.has(k)) gained.push(k);
  }
  return gained;
}

/** THE SAME KIND OF CARD: the same card types on its front face, supertypes and Kindred aside. */
const SHAPE_TYPES = ["artifact", "battle", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery"];
function shape(d: DeckCard): string {
  const front = (d.card.typeLine ?? "").split("//")[0]!.split(/[—-]/)[0]!.toLowerCase();
  return SHAPE_TYPES.filter((t) => new RegExp(`\\b${t}\\b`).test(front)).join(" ");
}
const isCreature = (d: DeckCard) => shape(d).split(" ").includes("creature");

/** CONDITIONS THE MEASURES DO NOT SEE. A card that asks for something before it does its job, or
 *  hands something back, is not the same card as one that just does it, and derive can miss the
 *  condition (Isolate's "with mana value 1", 2026-09-30). The add may print no condition the cut does
 *  not print too. Reminder text is not read. */
const CONDITIONS: readonly RegExp[] = [
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
  return true;
}

export interface RoleOption {
  add: string;
  /** The section role the add is better in. */
  role: Role;
  /** What the add is better at, and the two sides' values in that role, for the reason. */
  gained: Ingredient[];
  cut: Ingredients;
  addIngredients: Ingredients;
  gameChanger: boolean;
  /** Deck cards whose partner lists name the add. */
  links: number;
}
export interface LandOption { add: string; cut: LandFacts; addFacts: LandFacts; untapped: boolean; colours: string[]; gameChanger: boolean }
export interface CutOptions<O> { cut: string; options: O[] }
export interface Candidate { dc: DeckCard; roles: readonly Role[]; links: number }

/** ONE PAIR: the same job in every role the cut fills, no worse in any, better in a section role. */
export function roleOption(section: RoleSectionId, cut: DeckCard, add: Candidate): RoleOption | null {
  const cutRoles = rolesOfCard(cut);
  if (!cutRoles.every((r) => add.roles.includes(r))) return null;
  let best: RoleOption | null = null;
  for (const role of cutRoles) {
    if (!sameJob(cut, add.dc, role)) return null;
    const x = ingredients(cut, role);
    const y = ingredients(add.dc, role);
    const gained = strictlyBetter(x, y);
    if (gained === null) return null;
    if (SECTION_ROLES[section].includes(role) && gained.length > 0 && (!best || gained.length > best.gained.length)) {
      best = { add: add.dc.card.name, role, gained, cut: x, addIngredients: y, gameChanger: add.dc.card.gameChanger === true, links: add.links };
    }
  }
  return best;
}

/** THE OPTIONS FOR ONE ROLE SECTION, cut by cut, ranked by measures gained, then mana saved, then
 *  links to this deck, then name; cuts by their best option the same way. */
export function roleOptions(section: RoleSectionId, cuts: readonly DeckCard[], pool: readonly Candidate[]): CutOptions<RoleOption>[] {
  const out: CutOptions<RoleOption>[] = [];
  for (const cut of cuts) {
    if (!rolesOfCard(cut).some((r) => SECTION_ROLES[section].includes(r))) continue;
    const options = pool.map((c) => roleOption(section, cut, c)).filter((o): o is RoleOption => o !== null);
    if (options.length === 0) continue;
    options.sort(byOption);
    out.push({ cut: cut.card.name, options });
  }
  return out.sort((a, b) => byOption(a.options[0]!, b.options[0]!) || a.cut.localeCompare(b.cut));
}

const saved = (o: RoleOption) => (o.cut.manaValue ?? 0) - (o.addIngredients.manaValue ?? 0);
function byOption(a: RoleOption, b: RoleOption): number {
  return b.gained.length - a.gained.length || saved(b) - saved(a) || b.links - a.links || a.add.localeCompare(b.add);
}

export interface LandCandidate { facts: LandFacts; dc: DeckCard; gameChanger: boolean }

/** A REPLACEMENT FOR A BRING-DOWN CUT: the same job in every role the cut fills, never a Game Changer,
 *  but not required to be better. A Game Changer is usually the best card at its job, so nothing is
 *  strictly better than it; the replacement only keeps the slot doing what it did. */
export interface Replacement { add: string; role: Role; links: number }
export function replacements(cut: DeckCard, pool: readonly Candidate[]): Replacement[] {
  const roles = rolesOfCard(cut);
  if (roles.length === 0) return [];
  return pool
    .filter((c) => c.dc.card.gameChanger !== true && roles.every((r) => c.roles.includes(r) && sameJob(cut, c.dc, r)))
    .sort((a, b) => b.links - a.links || (a.dc.card.manaValue ?? 0) - (b.dc.card.manaValue ?? 0) || a.dc.card.name.localeCompare(b.dc.card.name))
    .map((c) => ({ add: c.dc.card.name, role: roles[0]!, links: c.links }));
}

/** THE LAND SECTION'S OPTIONS: for each land the deck may give up, the strictly better lands (no
 *  condition printed beyond entering tapped: not a storage land, not one that sacrifices another, not
 *  one that feeds an opponent), ranked by how seldom the add enters tapped, then colours gained, then
 *  name. A basic is offered for cutting only while the deck keeps more basics than its own cards
 *  search for; a basic is never added, so no swap asks for a second copy of anything. Nonbasic cuts
 *  rank before basics, and one basic stands for them all. */
export function landOptions(deckLands: readonly LandCandidate[], candidates: readonly LandCandidate[], basicsFloor: number): CutOptions<LandOption>[] {
  const basics = deckLands.filter((l) => l.facts.basic).length;
  const out: CutOptions<LandOption>[] = [];
  const seen = new Set<string>();
  for (const x of deckLands) {
    if (seen.has(x.facts.name) || (x.facts.basic && basics <= basicsFloor)) continue;
    seen.add(x.facts.name);
    const options: LandOption[] = [];
    for (const y of candidates) {
      // A TWO-FACED LAND IS ONE COLOUR OR THE OTHER (a Pathway), never both, so it is not offered.
      if (y.facts.basic || !y.facts.front || y.dc.card.typeLine.includes("//")) continue;
      // A LAND THAT IS ALSO AN ARTIFACT OR A CREATURE dies to what they die to, which no measure here reads.
      if (shape(y.dc) !== "land") continue;
      // ONLY WHAT IS NOT A LAND'S ORDINARY BUSINESS is read for conditions: a shock's "pay 2 life" and
      // a check land's "unless" are what `tapped` already measures. A cut land does nothing unusual
      // (`betterLand` never cuts one that does), so any condition on the add's other lines is new.
      const extra = unusualText(y.dc);
      if (CONDITIONS.some((re) => re.test(extra))) continue;
      const g = betterLand(x.facts, y.facts);
      if (g.ok) options.push({ add: y.facts.name, cut: x.facts, addFacts: y.facts, untapped: g.untapped, colours: g.colours, gameChanger: y.gameChanger });
    }
    if (options.length === 0) continue;
    options.sort(byLand);
    out.push({ cut: x.facts.name, options });
  }
  return out.sort((a, b) => Number(a.options[0]!.cut.basic) - Number(b.options[0]!.cut.basic) || byLand(a.options[0]!, b.options[0]!) || a.cut.localeCompare(b.cut));
}
function byLand(a: LandOption, b: LandOption): number {
  return a.addFacts.tapped - b.addFacts.tapped || b.colours.length - a.colours.length || a.add.localeCompare(b.add);
}

/** THE POOL, FROM THE STATIC CORPUS: every noncreature card in the name index that fills one of a
 *  section's roles, inside the commander's identity, not in the deck, and costing no more than the
 *  dearest card the section may cut (a prefilter only: the comparison reads the full mana value).
 *  Lands for the land section: every land in the identity that makes a colour. One `lookup` should
 *  serve a whole build, so a shard is fetched once for every precon that needs it. */
export async function upgradeOptions(input: {
  lookup: StaticLookup;
  /** Every card in the deck by physical name, commanders included. */
  deckNames: readonly string[];
  commanders: readonly string[];
  identity: readonly string[];
  /** The deck cards a role section may cut (the report's trim cards whose only protection is a role). */
  roleCuts: readonly string[];
  /** Cards the bracket guard cuts, which need a replacement whatever protects them. */
  bringDownCuts?: readonly string[];
}): Promise<{ roles: Record<RoleSectionId, CutOptions<RoleOption>[]>; lands: CutOptions<LandOption>[]; replacements: Map<string, Replacement[]> }> {
  const { lookup } = input;
  await lookup.prefetch(input.deckNames.map(normalizeName));
  const index = await decodeIndex(lookup);
  const dcOf = deckCards(lookup);
  const deck = (await Promise.all(input.deckNames.map(dcOf))).filter((d): d is DeckCard => d !== null);
  const identity = new Set(input.identity);
  const names = new Set(deck.map((d) => d.card.name));
  const inIdentity = (c: IndexCard) => c.identity.every((x) => identity.has(x));

  // LINKS: how many deck cards name a candidate in their partner lists, as the suggestions count them.
  const pi = new Map<string, readonly (readonly [number, number, ...number[]])[]>();
  for (const d of deck) {
    const ids = lookup.partnerIds(normalizeName(d.card.name));
    if (ids?.length) pi.set(d.card.name, ids);
  }
  const pool = candidatePool({ names, identity, pi }, index);
  const linksOf = new Map([...pool.values()].map((c) => [c.card.name, c.connections.length] as const));

  const roleCuts = deck.filter((d) => input.roleCuts.includes(d.card.name) && !isCreature(d));
  const roles = {} as Record<RoleSectionId, CutOptions<RoleOption>[]>;
  for (const section of ROLE_SECTIONS) {
    const sectionRoles = SECTION_ROLES[section] as readonly BuildCategory[];
    const cuts = roleCuts.filter((d) => rolesOfCard(d).some((r) => sectionRoles.includes(r)));
    const ceiling = Math.max(-1, ...cuts.map((d) => d.card.manaValue ?? 0));
    const wanted = index.filter((c) => !c.isLand && !names.has(c.name) && inIdentity(c) && c.mv <= ceiling
      && c.roles.some((r) => sectionRoles.includes(r as BuildCategory)));
    await lookup.prefetch(wanted.map((c) => normalizeName(c.name)));
    const candidates: Candidate[] = [];
    for (const c of wanted) {
      const dc = await dcOf(c.name);
      if (dc && !isCreature(dc)) candidates.push({ dc, roles: rolesOfCard(dc), links: linksOf.get(c.name) ?? 0 });
    }
    roles[section] = roleOptions(section, cuts, candidates);
  }

  // THE BRING-DOWN CUTS' REPLACEMENTS, from every card sharing a role with them, as cheap or cheaper.
  const replaced = new Map<string, Replacement[]>();
  for (const cut of deck.filter((d) => (input.bringDownCuts ?? []).includes(d.card.name))) {
    const roles = rolesOfCard(cut) as readonly BuildCategory[];
    if (roles.length === 0) { replaced.set(cut.card.name, []); continue; }
    const wanted = index.filter((c) => !c.isLand && !names.has(c.name) && inIdentity(c) && c.mv <= (cut.card.manaValue ?? 0)
      && roles.every((r) => c.roles.includes(r)));
    await lookup.prefetch(wanted.map((c) => normalizeName(c.name)));
    const pool: Candidate[] = [];
    for (const c of wanted) {
      const dc = await dcOf(c.name);
      if (dc && !isCreature(dc)) pool.push({ dc, roles: rolesOfCard(dc), links: linksOf.get(c.name) ?? 0 });
    }
    replaced.set(cut.card.name, replacements(cut, pool));
  }

  const needed = neededColours(deck);
  const library = deck.map((d) => d.card);
  const commanders = new Set(input.commanders);
  const deckLands = deck.filter((d) => !commanders.has(d.card.name) && /\bland\b/i.test(d.card.typeLine))
    .map((dc) => ({ facts: landFacts(dc, needed, library), dc, gameChanger: dc.card.gameChanger === true }));
  // EVERY LAND, NOT ONLY THE INDEXED ONES: the name index skips a land with no emit and no trigger,
  // which is every plain dual. `lands.json` has them all; a build from before it existed falls back.
  const allLands = await lookup.lands();
  const landPool = allLands.length ? allLands : index.filter((c) => c.isLand);
  const wantedLands = landPool.filter((c) => !names.has(c.name) && c.identity.length > 0 && c.identity.every((x) => identity.has(x)));
  await lookup.prefetch(wantedLands.map((c) => normalizeName(c.name)));
  const landCandidates: LandCandidate[] = [];
  for (const c of wantedLands) {
    const dc = await dcOf(c.name);
    if (dc && /\bland\b/i.test(dc.card.typeLine)) landCandidates.push({ facts: landFacts(dc, needed, library), dc, gameChanger: dc.card.gameChanger === true });
  }
  return { roles, lands: landOptions(deckLands, landCandidates, basicsFloor(deck)), replacements: replaced };
}
