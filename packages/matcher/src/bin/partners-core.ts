import type { GameEvent } from "@edh-seer/tagger";
import { directedReasons } from "../edges.js";
import type { DeckCard, Hierarchy } from "../types.js";

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

export type EventFrequency = Record<string, number>;

/** HOW MUCH ONE MATCHED EVENT IS WORTH.
 *
 *  Inverse log of how many cards in the corpus touch that event, so `enters|creature|goblin` (41
 *  cards) outranks `enters|creature|-` (1,909) without any appeal to how often either card is
 *  PLAYED. Popularity is not synergy: `cards.edhrecRank` exists, and is deliberately not consulted
 *  here or anywhere downstream of it.
 *
 *  WHAT THIS DOES AND DOES NOT CLAIM. It ranks how PRECISELY two cards interact, not how good
 *  either one is. A rare event can belong to a bad card, and the pages say so in those words rather
 *  than presenting the list as a recommendation.
 *
 *  AN UNSEEN KEY SCORES AS EXACTLY ONE MEMBER. `gen-theme-stats` recorded the alternative as a real
 *  defect: an absent tag scored `log(N+1)`, the maximum, so every tag the derived layer invented
 *  after the artifact was built looked maximally rare and dominated its axis -- `lose-life:opp` was
 *  absent, and an orzhov-spellslinger deck themed as "lose life". One member is the floor here, not
 *  the ceiling. */
export function specificity(key: string, freq: EventFrequency): number {
  return 1 / Math.log((freq[key] ?? 1) + 1);
}

/** DISTINCT CARDS per event key, counting a card ONCE per key however many of its abilities touch
 *  that event -- a card with three token-making abilities is still one card that supplies `enters`,
 *  and counting it three times would make the event look commoner than it is, which moves every
 *  score that key appears in.
 *
 *  Emits and demands are counted into the SAME table on purpose: specificity asks how crowded an
 *  event is, and a card is part of that crowd whichever side of the edge it stands on. */
export function countEvents(rows: Iterable<{ emits: string[]; demands: string[] }>): EventFrequency {
  const out: EventFrequency = {};
  for (const row of rows) {
    for (const k of new Set([...row.emits, ...row.demands])) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** THE COARSER FORMS OF ONE EVENT KEY, widest last: `enters|creature|goblin` also stands for
 *  `enters|creature|-` and for `enters|-|-`.
 *
 *  WHY THIS HAS TO EXIST. A goblin token entering IS a creature entering, so Krenko's
 *  `enters|creature|goblin` emit satisfies Impact Tremors' `enters|creature|-` trigger -- the engine
 *  knows that through the type hierarchy, and a string comparison cannot. Without generalisation the
 *  index rejected the pair the whole design was argued from, which is what the test caught.
 *
 *  IT IS DELIBERATELY OVER-PERMISSIVE, and that is safe because this is a SELECTOR, not a matcher.
 *  Its only job is to decide who is worth handing to `directedReasons`; every false candidate it
 *  admits is rejected one phase later, and `VERIFY_LIMIT` bounds what that costs. Being too strict
 *  here loses a real edge silently, which is the failure that cannot be recovered downstream. */
export function keyVariants(key: string): string[] {
  const [verb, type, subtype] = key.split("|");
  const out = [key];
  if (subtype !== "-") out.push(`${verb}|${type}|-`);
  if (type !== "-") out.push(`${verb}|-|-`);
  return out;
}

export interface PartnerRow {
  name: string;
  slug: string;
  score: number;
  /** The event key that earned the score -- what the page prints beside the row. */
  event: string;
  /** The ENGINE'S sentence, naming both cards. Not composed here. */
  reason: string;
}

/** HOW MANY CANDIDATES ARE WORTH RUNNING THE ENGINE OVER.
 *
 *  A card emitting `enters|creature|-` has 1,909 candidates, and calling `directedReasons` on all of
 *  them for each of the ~14,900 substantive cards is the build that never finishes. Candidates are
 *  ranked by the cheap score first and only the top `VERIFY_LIMIT` are verified.
 *
 *  CEILING: a genuinely specific partner sitting below rank 200 on a very common event is lost.
 *  Upgrade path: raise the limit, or bucket candidates by event key and verify per bucket so a rare
 *  key cannot be crowded out by a common one. */
export const VERIFY_LIMIT = 200;

/** How many rows a page shows. A readability choice, not a measured one -- a list a reader can
 *  finish. Tunable. */
export const KEEP = 24;

/** THE PARTNER LIST FOR ONE CARD: rank by specificity, then verify with the engine.
 *
 *  TWO PHASES, AND THE SPLIT IS THE POINT. `eventKey` decides who is worth ASKING about;
 *  `directedReasons` decides whether there is an edge and supplies the sentence. A key match is
 *  necessary and NOT sufficient -- Krenko's emit and a trigger wanting a creature an OPPONENT
 *  controls share `enters|creature|-` and form no edge -- so every row here survived the same
 *  function the deck report and the compass regression run on.
 *
 *  Computing the join here instead would be a SECOND matcher, drifting from the first. That is the
 *  failure `graph-events.ts` names when it says a graph that computed its own edges would drift,
 *  and this artifact would drift the same way for the same reason. */
export function partnersFor(
  subject: DeckCard,
  candidates: DeckCard[],
  freq: EventFrequency,
  slugs: Map<string, string>,
  h: Hierarchy,
): PartnerRow[] {
  const subjectEmits = new Set(
    (subject.tags?.abilities ?? [])
      .flatMap((a) => (a.emits ?? []).map(eventKey))
      .flatMap(keyVariants),
  );
  if (subjectEmits.size === 0) return [];

  const ranked = candidates
    // A CARD IS NEVER ITS OWN PARTNER. `directedReasons(x, x)` can return reasons, and
    // self-reference is the largest defect family this engine has had -- 74% of all false edges --
    // so the exclusion is explicit rather than left to the reason layer.
    .filter((c) => c.card.name !== subject.card.name)
    .map((c) => {
      let best = "";
      let score = 0;
      for (const a of c.tags?.abilities ?? []) {
        for (const verb of a.trigger?.verbs ?? []) {
          const key = eventKey({ verb, subject: a.trigger!.subject } as GameEvent);
          // BOTH SIDES GENERALISE, because either can be the more specific one: a goblin-token emit
          // meeting a creature demand, or a creature emit meeting a goblin demand. The SCORE stays
          // on the demand's EXACT key -- generalising that too would price every event as its
          // widest form and flatten the ranking this whole module is for.
          if (!keyVariants(key).some((v) => subjectEmits.has(v))) continue;
          const s = specificity(key, freq);
          if (s > score) { score = s; best = key; }
        }
      }
      return { card: c, score, event: best };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, VERIFY_LIMIT);

  const rows: PartnerRow[] = [];
  for (const r of ranked) {
    const reasons = directedReasons(subject, r.card, h);
    if (reasons.length === 0) continue;
    rows.push({
      name: r.card.card.name,
      slug: slugs.get(r.card.card.name) ?? slugOf(r.card.card.name),
      score: r.score,
      event: r.event,
      reason: reasons[0]!.text,
    });
    if (rows.length === KEEP) break;
  }
  return rows;
}
