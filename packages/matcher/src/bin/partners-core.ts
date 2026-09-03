import type { GameEvent } from "@edh-seer/tagger";

/** PURE, AND IT HAS TO STAY THAT WAY. `build-partners.ts` is the Mongo and fs wiring; everything
 *  decidable lives here, for the reason `build-static-core.ts` was split out of its own bin --
 *  importing a bin RUNS it, and the browser needs the slug and shard rules too. No `node:fs`, no
 *  Mongo, no top-level side effects in this file. */

/** A CARD NAME BECOMES A URL.
 *
 *  Diacritics are FOLDED rather than dropped: NFD splits a letter from its combining mark and the
 *  mark alone is removed, so `Jötun Grunt` reads `jotun-grunt` and not `jtun-grunt`. `Æ` is not a
 *  letter-plus-mark and NFD does not touch it, so it is mapped explicitly -- it appears in real card
 *  names (`Æther Vial`) and would otherwise vanish into a hyphen.
 *
 *  AN APOSTROPHE IS DELETED, NOT HYPHENATED. `Ajani's Chosen` is `ajanis-chosen`; letting it fall
 *  through to the general rule gives `ajani-s-chosen`, a URL with a one-letter segment in it that
 *  no reader would type and no search would match. Both the typewriter and the typographic
 *  apostrophe are removed, because Scryfall's names carry either. This is also what Scryfall and
 *  EDHREC do, which matters: these URLs are guessable only if they are guessable the same way.
 *
 *  Every other run of non-alphanumerics collapses to ONE hyphen, so `Fire // Ice` does not leave a
 *  double one, and leading/trailing hyphens are trimmed. */
export function slugOf(name: string): string {
  return name
    .replace(/Æ/g, "AE").replace(/æ/g, "ae")
    .replace(/['\u2019]/g, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** TWO CARDS CAN SLUG THE SAME AND ONE URL CANNOT SERVE BOTH.
 *
 *  Resolved by SORTED NAME rather than by input order, because the build reads Mongo and a rebuild
 *  that returned the same cards in a different order would otherwise swap two cards' URLs --
 *  silently, and only for the pair that collided. The first name by sort keeps the bare slug; the
 *  rest are suffixed `-2`, `-3`.
 *
 *  The map is written into the artifact, so the BUILD is the authority on every slug and the client
 *  never recomputes one it might disagree about. */
export function resolveSlugs(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Map<string, number>();
  for (const name of [...names].sort()) {
    // AN EMPTY SLUG IS NOT MERELY UGLY, IT IS A DIFFERENT PAGE. `/cards/` with nothing after it is
    // the card SEARCH route, so a card whose name slugs to "" would claim the collection's own URL.
    // MEASURED, not hypothetical: two cards in the corpus do it -- `_____` and `______`, whose names
    // are entirely underscores -- and uniqueness alone would have handed one of them "" and the
    // other "-2". Both are wrong URLs; this gives `card` and `card-2`.
    const base = slugOf(name) || "card";
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    out.set(name, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}

/** THE UNIT SPECIFICITY IS COUNTED OVER: verb, subject type, subject subtype.
 *
 *  It is the coarsest key that still separates `enters|creature|goblin` (41 cards corpus-wide) from
 *  `enters|creature|-` (1,909), which is the whole basis of the ranking.
 *
 *  IT IS A COUNTING KEY, NOT A MATCHING ONE. Whether a supply actually satisfies a demand is
 *  `directedReasons`' answer and nothing else's -- this string decides only who is worth asking
 *  about. A key that decided edges would be a second matcher, drifting from the first, which is the
 *  failure `graph-events.ts` names when it says a graph that computed its own edges would drift.
 *
 *  `type` and `subtype` are `string | string[]` in the schema, so an array is sorted before joining:
 *  ["instant","sorcery"] and ["sorcery","instant"] are one event, not two. */
export function eventKey(e: GameEvent): string {
  const s = e.subject ?? {};
  const one = (v: string | string[] | undefined): string =>
    v === undefined ? "-" : Array.isArray(v) ? [...v].sort().join(",") : v;
  return `${e.verb}|${one(s.type)}|${one(s.subtype)}`;
}
