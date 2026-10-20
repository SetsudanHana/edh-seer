import type { ManaLine } from "../schema.js";

/** THE ONE LIST OF NAMED PREDEFINED TOKEN KINDS (#1268 F9). Three readers kept their own list of "the tokens that are
 *  not a body", each a different cut of the same set; each now takes the kinds carrying its flag. Pure data, no node
 *  imports, so the browser bundle can read it.
 *
 *  - `fodder`: a card MEANT to be sacrificed, whose sacrifice is no cost of its payoff (`sacrificesForSamePayoff`, edges.ts;
 *    owner 2026-10-16). Food, Treasure, Clue, Blood, Gold -- EXACTLY these five.
 *    CEILING: Map and Junk are not fodder here and may belong (Fable round 3 asked); unchanged on purpose, because this
 *    was a refactor. Changing it is a behaviour change that needs its own measurement.
 *  - `resource`: mana, a card or a land, never a board presence (`RESOURCE_TOKENS`, archetypes.ts; wincon go-wide reads it).
 *  - `replaced`: a token NAME that can stand in a creation-replacement's replaced set (`REPLACED_TOKEN_NAMES`, derive/mana-lines.ts).
 *  - `line`: the token-maker mana line a card that makes this token carries (derive/mana-lines.ts `MANA_TOKENS`; a Lander has one that states no mana).
 *  - `manaToken`: the token ADDS mana (CR 111.10: Treasure, Gold, Powerstone 111.10h, Vibranium 111.10w, Heartwood 111.10x, Eldrazi Spawn/Scion). Read by derive's
 *    `ADDED_MANA_TOKENS` (a creation replacement that adds one) and matcher quality.ts `MANA_TOKENS` (ramp ingredients). Eldrazi Spawn/Scion are keyed by the
 *    joined subtype ("eldrazi-spawn"), distinct from the `replaced` name keys `eldrazi`/`spawn`/`scion` (#1282).
 *  The name says ARTIFACT but Role, Aura, Shard, Mutagen are not artifacts: the list is the predefined and named
 *  tokens (CR 111.10), and the flags say which cut a reader wants. */
export type TokenLine = Pick<ManaLine, "colours" | "colourless" | "anyColour" | "restriction">;
export interface TokenKind { readonly fodder?: true; readonly resource?: true; readonly replaced?: true; readonly manaToken?: true; readonly line?: TokenLine }

const ANY: TokenLine = { colours: ["W", "U", "B", "R", "G"], colourless: 0, anyColour: "any", restriction: null };
const ARTIFACT_ONLY = { spend: "can't be spent to cast a nonartifact spell", typeName: "artifact", minManaValue: null } as const;
const POWERSTONE: TokenLine = { colours: [], colourless: 1, anyColour: null, restriction: ARTIFACT_ONLY };
const COLOURLESS: TokenLine = { colours: [], colourless: 1, anyColour: null, restriction: null };

export const ARTIFACT_TOKEN_KINDS: Readonly<Record<string, TokenKind>> = {
  treasure: { fodder: true, resource: true, replaced: true, manaToken: true, line: ANY },
  clue: { fodder: true, resource: true, replaced: true },
  food: { fodder: true, resource: true, replaced: true },
  blood: { fodder: true, resource: true, replaced: true },
  map: { resource: true, replaced: true },
  gold: { fodder: true, resource: true, replaced: true, manaToken: true, line: ANY },
  powerstone: { resource: true, replaced: true, manaToken: true, line: POWERSTONE },
  incubator: { resource: true, replaced: true },
  junk: { resource: true, replaced: true },
  // Heartwood and Vibranium are mana, a Lander fetches a land, a Mutagen is a +1/+1 counter.
  // CR 111.10x: "{T}: Add {R} or {G}." -- the colours a non-token {T}: Add {R} or {G} line carries.
  heartwood: { resource: true, manaToken: true, line: { colours: ["R", "G"], colourless: 0, anyColour: null, restriction: null } },
  // Owner 2026-10-13 (#1190): a land-fetch token like Treasure; its makers keep the Ramp role, and its line states no mana (so no `manaToken`).
  lander: { resource: true, replaced: true, line: { colours: [], colourless: 0, anyColour: null, restriction: null } },
  mutagen: { resource: true, replaced: true },
  vibranium: { resource: true, manaToken: true, line: POWERSTONE },
  "eldrazi-spawn": { manaToken: true, line: COLOURLESS },
  "eldrazi-scion": { manaToken: true, line: COLOURLESS },
  // A Role is an Aura the token layer attaches to a creature; an Aura token is the same shape. Neither is a body.
  role: { resource: true, replaced: true },
  aura: { resource: true },
  shard: { replaced: true },
  eldrazi: { replaced: true },
  spawn: { replaced: true },
  scion: { replaced: true },
};

/** The kinds carrying one flag. */
export const tokenKindsWith = (flag: keyof TokenKind): ReadonlySet<string> =>
  new Set(Object.entries(ARTIFACT_TOKEN_KINDS).filter(([, k]) => k[flag] === true).map(([name]) => name));
