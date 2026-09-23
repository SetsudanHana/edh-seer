/** A DEMAND ROW'S KEY, AS CANDIDATE EVENT KEYS (spec 2026-09-24 deck suggestions, §3, "The demand
 *  key is not an `events/` key").
 *
 *  `deckMath.demand[].key` is the census format (`census.ts`: `enters:subtype:goblin`,
 *  `enters-graveyard:type:land`, `attacks:any (narrowed)`); the event index is `eventKey`'s
 *  `verb|type|subtype|token`. The census key has no token slot and a subtype key drops the type, so
 *  this is a FILTER that over-collects on purpose. It never decides a pair: `suggest-static.ts`
 *  shows a candidate only when `directedReasons` finds a reason from it to a deck card.
 *
 *  STRING OPS, NOT A REGEX: a pattern with optional tails is the shape CodeQL has failed this repo's
 *  required check on before (polynomial ReDoS). */
/** PRODUCER VERBS THE ENGINE ACCEPTS FOR A DEMAND VERB, beyond the verb itself -- the three bridges
 *  `verbSatisfies` (edges.ts) draws: a death is a leave (CR 700.4), damage to a player is life loss
 *  (CR 120.3), and a damage emit can be what a creature is dealt. Their subject conditions are left
 *  to the engine; this only has to not refuse the producer before it is asked. KEEP IN STEP with
 *  `verbSatisfies`: a bridge added there and not here is a supply the suggestions never collect. */
const ALSO_SUPPLIED_BY: Record<string, readonly string[]> = {
  leaves: ["dies"],
  "lose-life": ["non-combat-damage"],
  damaged: ["non-combat-damage", "combat-damage"],
};

export function eventKeysForDemand(censusKey: string, eventKeys: readonly string[]): string[] {
  const key = censusKey.endsWith(" (narrowed)") ? censusKey.slice(0, -" (narrowed)".length) : censusKey;
  const colon = key.indexOf(":");
  if (colon <= 0) return [];
  const verb = key.slice(0, colon);
  const subject = key.slice(colon + 1);
  let slot: 1 | 2 | null;
  let want: string[] = [];
  if (subject === "any") slot = null;
  else if (subject.startsWith("type:")) { slot = 1; want = subject.slice("type:".length).split("+"); }
  else if (subject.startsWith("subtype:")) { slot = 2; want = subject.slice("subtype:".length).split("+"); }
  else return [];
  if (slot !== null && want.some((w) => w === "")) return [];
  const verbs = [verb, ...(ALSO_SUPPLIED_BY[verb] ?? [])];
  return eventKeys.filter((k) => {
    const parts = k.split("|");
    return verbs.includes(parts[0]!) && (slot === null || want.includes(parts[slot]!));
  });
}
