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
import type { BuildCategory } from "./build.js";
import { basicsFloor, betterLand, landFacts, neededColours, unusualText, type LandFacts } from "./land-score.js";
import { fetchableLands } from "./fetch-land.js";
import { COLORS, colourDeficit, landTypeDemand, type Color } from "./mana-audit.js";
import { ingredients, rolesOfCard, type Ingredient, type Ingredients, type Role } from "./quality.js";
import type { StaticLookup } from "./static-lookup.js";
import { candidatePool, type IndexCard } from "./suggest.js";
import { decodeIndex, deckCards } from "./suggest-static.js";
import type { DeckCard } from "./types.js";
import type { UpgradeSectionId } from "./upgrade-package.js";
import { CONDITIONS, isCreature, netPositiveMana, sameGroup, creatureSubtypes, landAuraType, isFetchSpell, landsToBattlefield, singleLandFetch, sameDorkAnyColour, sameFetchAnyColour, sameJob, sameRockAnyColour, themedSubjects, shape } from "./same-job.js";
export { answerCovers, newConditions, sameGroup, sameJob } from "./same-job.js";

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
    // AN AMOUNT THAT CANNOT BE READ IS NOT A WORSE ONE (review of #1051): an X or a conditional draw on
    // the add leaves `amount` unset, and refusing on that dropped cheaper, faster swaps whole.
    if (a === undefined && k === "amount") continue;
    if (a === undefined) return null;
    if (LOWER_IS_BETTER.has(k) ? a > c : a < c) return null;
    if (a !== c && !NOT_A_GAIN.has(k)) gained.push(k);
  }
  return gained;
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
  /** A Game Changer in the cut's group (`gameChangerOption`), not a strictly better card. */
  upgrade?: "game-changer";
  /** A COLOUR SWAP (#966): the colours the deck is short of that the add makes and the cut does not. */
  colour?: Color[];
  /** Roles the cut fills that the add does not (Mind Stone's draw): a colour swap says what it gives up. */
  lost?: Role[];
  /** The shortfall this colour swap closes by the yardstick itself: the deficit before less the deficit after. */
  closed?: number;
  /** A swap that changes card type, toward a type the deck's payoffs watch (an enchantress's Aura for a rock). */
  crossType?: string;
  /** A dork swap that keeps a creature type the deck's themes name (Elf): the reason says it is still one. */
  keptType?: string;
  /** The add is a land-fetch spell: the reason says it can find a land of the colour. */
  fetch?: boolean;
}
export interface LandOption { closed?: number; add: string; cut: LandFacts; addFacts: LandFacts; untapped: boolean; colours: string[]; gameChanger: boolean }
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

const MADE_COLOURS = (d: DeckCard): Color[] => COLORS.filter((c) => (d.card.producedMana ?? []).includes(c));

/** A COLOUR SWAP FOR A ROCK (owner, 2026-10-08, #966): the same rock in everything but its colours, and
 *  the add makes a colour the deck is short of (`colourDeficit`) that the cut does not, keeping every
 *  colour the cut makes. "If you have Fire Diamond in Izzet you can replace it with a Talisman." The
 *  gain is the colour, not a measure, so `gained` is empty. A rock that prints more mana than it costs
 *  is never the cut. CEILING: rocks and plain dorks; a land fetcher makes no colour of its own. Where the payoff type matters (an enchantress wants
 *  enchantment ramp) shape blocks every cross-type pair here, so there is nothing to prefer. */
export function colourOption(cut: DeckCard, add: Candidate, deficit: Partial<Record<Color, number>>, closes?: Closes, watched: ReadonlySet<string> = new Set(), auraOk?: (add: DeckCard) => boolean, themed: ReadonlySet<string> = new Set(), fetchReach?: (d: DeckCard) => ReadonlySet<Color>): RoleOption | null {
  if (!rolesOfCard(cut).includes("ramp") || !add.roles.includes("ramp") || netPositiveMana(cut)) return null;
  // A LAND-FETCH SPELL MAKES NO COLOUR OF ITS OWN: its colours are those of the deck's lands it can find.
  const fetchCut = isFetchSpell(cut);
  const had = fetchCut && fetchReach ? [...fetchReach(cut)] : MADE_COLOURS(cut);
  const made = isFetchSpell(add.dc) && fetchReach ? [...fetchReach(add.dc)] : MADE_COLOURS(add.dc);
  if (!had.every((c) => made.includes(c))) return null;
  const colour = COLORS.filter((c) => made.includes(c) && !had.includes(c) && (deficit[c] ?? 0) > 0);
  // NO DEARER THAN THE CUT: `roleOption` gets this from `strictlyBetter`, a colour swap has to ask.
  if (colour.length === 0 || (add.dc.card.manaValue ?? 0) > (cut.card.manaValue ?? 0)) return null;
  // ANOTHER CARD TYPE ONLY TOWARD THE ONE THE DECK'S PAYOFFS WATCH (owner, 2026-10-08: an enchantress
  // wants enchantment ramp), never away from it, and never when the cut's type is watched too.
  // CEILING: across types the only add is an Aura that enchants a land (or a basic land type) and adds mana
  // by trigger. Enchant-creature Auras, 'Creatures you control have {T}: Add' enchantments and cross-type
  // non-Auras (an artifact for an enchantment) are left out: no measure here reads what else they do.
  let crossType: string | undefined;
  let keptType: string | undefined;
  if (isCreature(cut) || isCreature(add.dc)) {
    // A DORK FOR A DORK (owner, 2026-10-08), keeping every creature type the deck's themes name: an Elf deck's
    // Llanowar Elves gives way only to another Elf. CEILING: land-fetch spells are not swapped for colour.
    if (!sameDorkAnyColour(cut, add.dc)) return null;
    const kept = creatureSubtypes(cut).filter((t) => themed.has(t));
    const addTypes = creatureSubtypes(add.dc);
    if (!kept.every((t) => addTypes.includes(t))) return null;
    keptType = kept[0];
  } else if (fetchCut) {
    // A FETCH SPELL FOR A FETCH SPELL, or (toward a watched type only) for a land Aura. CEILING: creature
    // fetchers (Wood Elves) are never swapped.
    if (isFetchSpell(add.dc)) {
      if (!sameFetchAnyColour(cut, add.dc)) return null;
    } else {
      crossType = typesOf(add.dc).find((t) => watched.has(t));
      if (!crossType || typesOf(cut).some((t) => watched.has(t)) || landAuraType(add.dc) === null) return null;
      // ONLY A SINGLE PLAIN FETCH becomes an Aura: two lands (Explosive Vegetation), or one in hand too
      // (Cultivate), would be thrown away.
      if (landsToBattlefield(cut) !== 1 || !singleLandFetch(cut)) return null;
    }
  } else if (!sameRockAnyColour(cut, add.dc)) {
    const cutWatched = typesOf(cut).some((t) => watched.has(t));
    crossType = typesOf(add.dc).find((t) => watched.has(t));
    if (cutWatched || !crossType || !sameRockAnyColour(cut, add.dc, true)) return null;
  }
  if (auraOk && !auraOk(add.dc)) return null;
  // CLOSED BY THE YARDSTICK, NOT BY THE COLOUR'S NAME: the audit counts a rock only for a demand due
  // after its mana value, so a Talisman can make the colour and still move nothing (review of #966 T2).
  const closed = closes ? closes(cut.card.name, add.dc) : colour.reduce((n, c) => n + (deficit[c] ?? 0), 0);
  if (closed <= 0) return null;
  const lost = rolesOfCard(cut).filter((r) => !add.roles.includes(r));
  return { add: add.dc.card.name, role: "ramp", gained: [], cut: ingredients(cut, "ramp"), addIngredients: ingredients(add.dc, "ramp"), gameChanger: add.dc.card.gameChanger === true, links: add.links, colour, closed, ...(crossType ? { crossType } : {}), ...(keptType ? { keptType } : {}), ...(isFetchSpell(add.dc) ? { fetch: true } : {}), ...(lost.length ? { lost } : {}) };
}
/** A CARD'S TYPES as a payoff names them: its front-face card types, and Aura or Equipment. */
const typesOf = (d: DeckCard): string[] => [...shape(d).split(" "), ...(/\baura\b/i.test(d.card.typeLine ?? "") ? ["aura"] : []), ...(/\bequipment\b/i.test(d.card.typeLine ?? "") ? ["equipment"] : [])].filter(Boolean);
/** THE CARD TYPES THE DECK IS BUILT AROUND (owner, 2026-10-08): a type is watched only when
 *  `enters:<type>` or `cast:<type>` is among the deck's detected THEMES (the headline and the second
 *  the report names), never because one card happens to care. */
export function watchedTypes(themes: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of themes ?? []) {
    const m = /^(?:enters|cast):(artifact|enchantment|aura|equipment|creature|land|planeswalker)$/.exec(t);
    if (m) out.add(m[1]!);
  }
  return out;
}
/** "ENCHANT FOREST" IS A DEMAND FOR FORESTS (owner, 2026-10-08): the Aura needs a Forest to enchant, so it
 *  is judged as one more demand for that land type by its own mana value's turn, with `manaAudit`'s model
 *  (`landTypeDemand`). "Enchant land" needs no such check. CEILING: the demand is judged alone, against
 *  the deck's sources of the type as they stand, not against the Auras already in the deck. */
export function auraSupport(deck: readonly DeckCard[], commanders: readonly string[]): (add: DeckCard) => boolean {
  return (add) => {
    const type = landAuraType(add);
    if (!type || type === "land") return true;
    const { required, available } = landTypeDemand(deck, commanders, type, Math.max(1, Math.round(add.card.manaValue ?? 1)));
    return available >= required;
  };
}
/** The total colour shortfall a swap of the named deck card for `add` closes (`swapCloser`). */
export type Closes = (cutName: string, add: DeckCard) => number;
/** THE YARDSTICK, RUN ON THE SWAP: the sum of `colourDeficit` for the deck, less the same for the deck
 *  with one copy of the cut replaced by the add. Memoised by pair; the audit is the cost, so callers
 *  prefilter on the colours first. */
export function swapCloser(deck: readonly DeckCard[], commanders: readonly string[]): Closes {
  const total = (d: readonly DeckCard[]) => Object.values(colourDeficit(d, commanders)).reduce((n, x) => n + x, 0);
  const base = total(deck);
  const seen = new Map<string, number>();
  return (cutName, add) => {
    const key = `${cutName}\0${add.card.name}`;
    let n = seen.get(key);
    if (n === undefined) {
      const i = deck.findIndex((d) => d.card.name === cutName);
      n = i < 0 ? 0 : base - total(deck.map((d, j) => (j === i ? add : d)));
      seen.set(key, n);
    }
    return n;
  };
}
const closedBy = (o: RoleOption) => o.closed ?? 0;

/** A card's role quality (the name index's `q`, 0-100), -1 when it has none in that role. */
export type QualityOf = (name: string, role: Role) => number;

/** A GAME CHANGER UPGRADE (#976; `docs/plans/2026-10-03-game-changer-upgrades.md`): brackets as power
 *  within a group. Not strictly better -- most Game Changers are strong through a condition `sameJob`
 *  refuses -- so it is its own kind of swap, held to its own measures. The add is a Game Changer, not
 *  a creature, fills every role the cut fills, in the same group (`sameGroup`), with a higher role
 *  quality in each, and works at least as often (`asOften`). The bracket guard decides where one may go: never at bracket 2, up to the cap at 3. */
export function gameChangerOption(section: RoleSectionId, cut: DeckCard, add: Candidate, quality: QualityOf): RoleOption | null {
  if (add.dc.card.gameChanger !== true || isCreature(add.dc) || isCreature(cut)) return null;
  const cutRoles = rolesOfCard(cut);
  const role = cutRoles.find((r) => SECTION_ROLES[section].includes(r));
  if (!role) return null;
  const name = add.dc.card.name;
  if (!cutRoles.every((r) => add.roles.includes(r) && sameGroup(cut, add.dc, r) && quality(name, r) > quality(cut.card.name, r) && asOften(cut, add.dc, r))) return null;
  return { add: name, role, gained: [], cut: ingredients(cut, role), addIngredients: ingredients(add.dc, role), gameChanger: true, links: add.links, upgrade: "game-changer" };
}

/** AT LEAST AS OFTEN: a card that works once never replaces one that works every turn. The first build
 *  offered Lion's Eye Diamond and Jeska's Will for Signets (2026-10-03). Unread on either side, no limit. */
function asOften(cut: DeckCard, add: DeckCard, role: Role): boolean {
  const c = ingredients(cut, role).frequency;
  const a = ingredients(add, role).frequency;
  return c === undefined || a === undefined || a >= c;
}

/** THE OPTIONS FOR ONE ROLE SECTION, cut by cut. A cut's Game Changer upgrades come first, strongest
 *  in the section's role first; the bracket guard refuses them at bracket 2, which then takes the
 *  cut's strict options, ranked by measures gained, then mana saved, then links to this deck, then
 *  name. Cuts are ranked by their best strict option the same way, then those with Game Changer
 *  upgrades only. */
export function roleOptions(
  section: RoleSectionId, cuts: readonly DeckCard[], pool: readonly Candidate[],
  gameChangers: { pool: readonly Candidate[]; quality: QualityOf } = { pool: [], quality: () => -1 },
  deficit: Partial<Record<Color, number>> = {},
  closes?: Closes,
  watched?: ReadonlySet<string>,
  auraOk?: (add: DeckCard) => boolean,
  themed?: ReadonlySet<string>,
  fetchReach?: (d: DeckCard) => ReadonlySet<Color>,
): CutOptions<RoleOption>[] {
  const out: (CutOptions<RoleOption> & { strict?: RoleOption; colour?: RoleOption; shortMade: number })[] = [];
  for (const cut of cuts) {
    if (!rolesOfCard(cut).some((r) => SECTION_ROLES[section].includes(r))) continue;
    const strict = pool.map((c) => roleOption(section, cut, c)).filter((o): o is RoleOption => o !== null).sort(byOption);
    // WHERE NO STRICT OPTION EXISTS FOR A PAIR, a rock may still close the deck's colour shortfall. Best
    // first: the most shortfall closed, then the deck's own links, then name.
    const strictAdds = new Set(strict.map((o) => o.add));
    const colour = section !== "ramp" ? [] : pool.filter((c) => !strictAdds.has(c.dc.card.name)).map((c) => colourOption(cut, c, deficit, closes, watched, auraOk, themed, fetchReach))
      .filter((o): o is RoleOption => o !== null)
      .sort((a, b) => closedBy(b) - closedBy(a) || b.links - a.links || a.add.localeCompare(b.add));
    const upgrades = gameChangers.pool.map((c) => gameChangerOption(section, cut, c, gameChangers.quality)).filter((o): o is RoleOption => o !== null)
      .sort((a, b) => gameChangers.quality(b.add, b.role) - gameChangers.quality(a.add, a.role) || a.add.localeCompare(b.add));
    if (strict.length + upgrades.length + colour.length === 0) continue;
    const shortMade = MADE_COLOURS(cut).reduce((n, c) => n + (deficit[c] ?? 0), 0);
    out.push({ cut: cut.card.name, options: [...upgrades, ...strict, ...colour], shortMade, ...(strict[0] ? { strict: strict[0] } : {}), ...(colour[0] ? { colour: colour[0] } : {}) });
  }
  // CUTS: those with a strict option first as before; then those that only close a colour shortfall,
  // worst first (the rock making the least of the colours the deck is short of); Game Changer upgrades last.
  const tier = (c: { strict?: RoleOption; colour?: RoleOption }) => (c.strict ? 0 : c.colour ? 1 : 2);
  return out
    .sort((a, b) => tier(a) - tier(b)
      || (a.strict && b.strict ? byOption(a.strict, b.strict) : 0)
      || (tier(a) === 1 ? a.shortMade - b.shortMade || closedBy(b.colour!) - closedBy(a.colour!) : 0)
      || a.cut.localeCompare(b.cut))
    .map(({ cut, options }) => ({ cut, options }));
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
export function landOptions(deckLands: readonly LandCandidate[], candidates: readonly LandCandidate[], basicsFloor: number,
  deficit: Partial<Record<Color, number>> = {}, closes?: Closes): CutOptions<LandOption>[] {
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
      if (!g.ok) continue;
      const lo: LandOption = { add: y.facts.name, cut: x.facts, addFacts: y.facts, untapped: g.untapped, colours: g.colours, gameChanger: y.gameChanger };
      // THE SHORTFALL IT CLOSES, BY THE YARDSTICK (review of #966 T2): only an add that makes a short colour
      // the cut does not is worth the audit; a check dual tapped on turn one closes nothing of a turn-one demand.
      if (closedFormula(lo, deficit) > 0) lo.closed = closes ? closes(x.facts.name, y.dc) : closedFormula(lo, deficit);
      options.push(lo);
    }
    if (options.length === 0) continue;
    // THE ADD THAT CLOSES THE DECK'S COLOUR SHORTFALL COMES FIRST (owner, 2026-10-08), then the old order.
    options.sort((a, b) => (b.closed ?? 0) - (a.closed ?? 0) || byLand(a, b));
    out.push({ cut: x.facts.name, options });
  }
  // WORST CUT FIRST (owner, 2026-10-08, #966): nonbasics before basics as before, then always tapped
  // before sometimes before never, then the land making no colour the deck is short of (the shortfall
  // it makes, least first), then the old order (best add) so nothing that does not differ moves.
  const shortMade = (c: CutOptions<LandOption>) => c.options[0]!.cut.colours.reduce((n, k) => n + (deficit[k as Color] ?? 0), 0);
  return out.sort((a, b) => Number(a.options[0]!.cut.basic) - Number(b.options[0]!.cut.basic)
    || b.options[0]!.cut.tapped - a.options[0]!.cut.tapped || shortMade(a) - shortMade(b)
    || byLand(a.options[0]!, b.options[0]!) || a.cut.localeCompare(b.cut));
}
/** THE SHORTFALL AN ADD CLOSES: the deficit of every short colour it makes that the cut does not. */
function closedFormula(o: LandOption, deficit: Partial<Record<Color, number>>): number {
  return o.addFacts.colours.filter((c) => !o.cut.colours.includes(c)).reduce((n, c) => n + (deficit[c as Color] ?? 0), 0);
}
function byLand(a: LandOption, b: LandOption): number {
  return a.addFacts.tapped - b.addFacts.tapped || b.colours.length - a.colours.length || a.add.localeCompare(b.add);
}

/** A PREFILTER ONLY: every Game Changer with a section role was rated 95 or more in one in the
 *  2026-10-03 index (34 cards), so a card under this is not fetched to ask whether it is one. */
const GAME_CHANGER_FLOOR = 90;

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
  /** The deck's detected themes as tags (`enters:enchantment`): the headline and the second the report names. */
  themes?: readonly string[];
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

  // A DORK MAY BE CUT FOR A COLOUR (ramp section only; every other section skips a creature below).
  const roleCuts = deck.filter((d) => input.roleCuts.includes(d.card.name));
  // THE GAME CHANGERS IN THE IDENTITY. The flag is on the card, not in the name index, so the index
  // prefilters to cards rated `GAME_CHANGER_FLOOR` or more in a role and the card says which they are.
  const qualities = new Map(index.map((c) => [c.name, c.quality ?? {}] as const));
  const quality: QualityOf = (name, role) => qualities.get(name)?.[role] ?? -1;
  const sectionRoles = new Set<string>(Object.values(SECTION_ROLES).flat());
  const strong = index.filter((c) => !c.isLand && !names.has(c.name) && inIdentity(c) && c.roles.some((r) => sectionRoles.has(r))
    && Math.max(-1, ...Object.values(c.quality ?? {})) >= GAME_CHANGER_FLOOR);
  await lookup.prefetch(strong.map((c) => normalizeName(c.name)));
  const gameChangers: Candidate[] = [];
  for (const c of strong) {
    const dc = await dcOf(c.name);
    if (dc && dc.card.gameChanger === true && !isCreature(dc)) gameChangers.push({ dc, roles: rolesOfCard(dc), links: linksOf.get(c.name) ?? 0 });
  }
  const deficit = colourDeficit(deck, input.commanders);
  const closes = swapCloser(deck, input.commanders);
  const watched = watchedTypes(input.themes);
  const libraryLands = deck.filter((d) => !input.commanders.includes(d.card.name)).map((d) => d.card);
  const fetchReach = (d: DeckCard): ReadonlySet<Color> => new Set(fetchableLands(d.card.oracleText ?? "", libraryLands).flatMap((c) => c.producedMana ?? []).filter((c): c is Color => (COLORS as readonly string[]).includes(c)));
  const roles = {} as Record<RoleSectionId, CutOptions<RoleOption>[]>;
  for (const section of ROLE_SECTIONS) {
    const sectionRoles = SECTION_ROLES[section] as readonly BuildCategory[];
    const cuts = roleCuts.filter((d) => rolesOfCard(d).some((r) => sectionRoles.includes(r)) && (section === "ramp" || !isCreature(d)));
    const ceiling = Math.max(-1, ...cuts.map((d) => d.card.manaValue ?? 0));
    const wanted = index.filter((c) => !c.isLand && !names.has(c.name) && inIdentity(c) && c.mv <= ceiling
      && c.roles.some((r) => sectionRoles.includes(r as BuildCategory)));
    await lookup.prefetch(wanted.map((c) => normalizeName(c.name)));
    const candidates: Candidate[] = [];
    for (const c of wanted) {
      const dc = await dcOf(c.name);
      if (dc && (section === "ramp" || !isCreature(dc))) candidates.push({ dc, roles: rolesOfCard(dc), links: linksOf.get(c.name) ?? 0 });
    }
    roles[section] = roleOptions(section, cuts, candidates, { pool: gameChangers, quality }, deficit, closes, watched, auraSupport(deck, input.commanders), themedSubjects(input.themes), fetchReach);
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
  return { roles, lands: landOptions(deckLands, landCandidates, basicsFloor(deck), deficit, closes), replacements: replaced };
}
