import { identityMask, type EventFrequencyFile, type EventMembers } from "./partners-core.js";

/** ONE EVENT, NARROWED ONLY WHEN ASKED (owner, 2026-09-29: "we already support filtering by type,
 *  so appending the card type or subtype to the event in search is redundant", and "you have plain
 *  sacrifice but you can narrow it down by picking up the target").
 *
 *  The search listed every key the engine derives: `dies|creature|-|-`, `dies|artifact|-|-`,
 *  `dies|-|goblin|-` and 70 more deaths, each its own row. A PATTERN is an event key whose open
 *  slots are `*`: `dies|*|*|*` is "something dies", and narrowing fills ONE slot -- a type
 *  (`dies|creature|*|*`), a subtype (`enters|*|wizard|*`) or the token flag (`sacrifice|*|*|t`).
 *
 *  BOTH SIDES ARE UNIONS, BUILT ONCE. A pattern key ships in the event index like any other key,
 *  its `p` the cards that make any event it covers happen and its `c` the cards that pay off any
 *  demand it covers, so the page answers a pattern with one fetch, exactly as it answers a key.
 *  The supply side is only partly generalised already (`supplyForms` gives `dies|-|-|-`, but not
 *  `create-token|-|-|-` or `dies|-|-|n`: 51 real-event patterns measured 2026-09-29 have no
 *  generalised key), so the union is taken rather than borrowed from the `-` form.
 *
 *  A narrowed pay-off covers the demands that NAME that target: `dies|creature|*|*` is the cards
 *  that ask for a creature (a Goblin, a nontoken one) to die, not the ones that ask for anything
 *  to. Said plainly, because the other reading is also defensible. */
export const ANY = "*";

/** A key with at least one open slot. Every key the engine derives spells its slots `-` or a value. */
export const isPattern = (key: string): boolean => key.split("|").slice(1).includes(ANY);

/** The verb, and its base pattern: `dies|creature|-|-` -> `dies|*|*|*`. */
export const verbOfKey = (key: string): string => key.split("|")[0] ?? "";
export const baseOf = (key: string): string => `${verbOfKey(key)}|${ANY}|${ANY}|${ANY}`;

/** The key a pattern reads as in the engine's own spelling, `*` as `-`: the supply form whose
 *  "how much it does" order a pattern's makers keep where there is one. */
export function supplyKeyOf(key: string): string {
  if (!isPattern(key)) return key;
  return key.split("|").map((part, i) => (i > 0 && part === ANY ? "-" : part)).join("|");
}

/** What a pattern narrows to, or null for a base pattern (or a plain key). */
export function narrowingOf(key: string): { slot: "type" | "subtype" | "token"; value: string } | null {
  if (!isPattern(key)) return null;
  const [, type = ANY, subtype = ANY, token = ANY] = key.split("|");
  if (type !== ANY) return { slot: "type", value: type };
  if (subtype !== ANY) return { slot: "subtype", value: subtype };
  if (token !== ANY) return { slot: "token", value: token };
  return null;
}

/** THE PATTERNS ONE KEY BELONGS TO: its verb's base, and one per target it names. A slot may hold a
 *  list (`artifact,creature`), which is a disjunction, so the key belongs to each. */
export function patternsOf(key: string): string[] {
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");
  if (!verb) return [];
  const out = [`${verb}|${ANY}|${ANY}|${ANY}`];
  for (const t of type.split(",")) if (t && t !== "-") out.push(`${verb}|${t}|${ANY}|${ANY}`);
  for (const s of subtype.split(",")) if (s && s !== "-") out.push(`${verb}|${ANY}|${s}|${ANY}`);
  if (token === "t" || token === "n") out.push(`${verb}|${ANY}|${ANY}|${token}`);
  return out;
}

/** EVERY PATTERN, from the index's own keys: its makers (in the supply form's order where the index
 *  has one, then ascending) and its pay-offs (ascending). A pattern nothing makes or asks for is not
 *  written. */
export function eventPatterns(events: ReadonlyMap<string, EventMembers>): Map<string, EventMembers> {
  const makers = new Map<string, Set<number>>();
  const payers = new Map<string, Set<number>>();
  const add = (into: Map<string, Set<number>>, pattern: string, ids: readonly number[]) => {
    if (ids.length === 0) return;
    const set = into.get(pattern) ?? new Set<number>();
    for (const id of ids) set.add(id);
    into.set(pattern, set);
  };
  for (const [key, members] of events) {
    if (isPattern(key)) continue;
    for (const pattern of patternsOf(key)) { add(makers, pattern, members.p); add(payers, pattern, members.c); }
  }
  const out = new Map<string, EventMembers>();
  for (const pattern of new Set([...makers.keys(), ...payers.keys()])) {
    const made = makers.get(pattern) ?? new Set<number>();
    const ordered = (events.get(supplyKeyOf(pattern))?.p ?? []).filter((id) => made.has(id));
    const placed = new Set(ordered);
    const p = [...ordered, ...[...made].filter((id) => !placed.has(id)).sort((x, y) => x - y)];
    out.set(pattern, { p, c: [...(payers.get(pattern) ?? [])].sort((x, y) => x - y) });
  }
  return out;
}

/** THE PICKER'S COUNTS FOR THE PATTERNS, in `event-frequency.json`'s own shape: how many make each,
 *  how many pay it off, and the makers split into the 32 colour identities (`identityOf` reads a
 *  card's identity by its index position). */
export function patternFrequency(
  patterns: ReadonlyMap<string, EventMembers>,
  identityOf: (position: number) => readonly string[],
): EventFrequencyFile {
  const out: EventFrequencyFile = { supply: {}, consume: {}, byIdentity: {} };
  for (const [key, { p, c }] of patterns) {
    if (p.length > 0) {
      out.supply[key] = p.length;
      const slots = new Array<number>(32).fill(0);
      for (const id of p) slots[identityMask(identityOf(id))]! += 1;
      out.byIdentity[key] = slots;
    }
    if (c.length > 0) out.consume[key] = c.length;
  }
  return out;
}

/** THE TARGETS A VERB CAN BE NARROWED TO, from a list of keys the reader can ask (supply keys, pay-off
 *  patterns, or both): each as its pattern, once. Supply keys name one target per slot already
 *  (`dies|creature|-|-`, `dies|-|goblin|-`), so a key with exactly one slot set is a narrowing. */
export function narrowingsOf(verb: string, keys: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    const [v, type = "-", subtype = "-", token = "-"] = key.split("|");
    if (v !== verb) continue;
    const open = (x: string) => x === "-" || x === ANY;
    const set = [type, subtype, token].filter((x) => !open(x)).length;
    if (set !== 1 || type.includes(",") || subtype.includes(",")) continue;
    out.add([v, open(type) ? ANY : type, open(subtype) ? ANY : subtype, open(token) ? ANY : token].join("|"));
  }
  return [...out];
}
