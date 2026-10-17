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
 *  The name says ARTIFACT but Role, Aura, Shard, Mutagen are not artifacts: the list is the predefined and named
 *  tokens (CR 111.10), and the flags say which cut a reader wants. */
export interface TokenKind { readonly fodder?: true; readonly resource?: true; readonly replaced?: true }

export const ARTIFACT_TOKEN_KINDS: Readonly<Record<string, TokenKind>> = {
  treasure: { fodder: true, resource: true, replaced: true },
  clue: { fodder: true, resource: true, replaced: true },
  food: { fodder: true, resource: true, replaced: true },
  blood: { fodder: true, resource: true, replaced: true },
  map: { resource: true, replaced: true },
  gold: { fodder: true, resource: true, replaced: true },
  powerstone: { resource: true, replaced: true },
  incubator: { resource: true, replaced: true },
  junk: { resource: true, replaced: true },
  // Heartwood and Vibranium are mana, a Lander fetches a land, a Mutagen is a +1/+1 counter.
  heartwood: { resource: true },
  lander: { resource: true, replaced: true },
  mutagen: { resource: true, replaced: true },
  vibranium: { resource: true },
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
