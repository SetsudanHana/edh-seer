import type { GameEvent } from "@edh-seer/tagger";
import { ARCHETYPE_LABELS, type Archetype } from "../archetypes.js";
import { PARTNER_SHARD_COUNT, partnerShardOf } from "../partner-shard.js";
import { directedReasons, themeSubjectKey } from "../edges.js";
import { normalizeZoneEvent, zoneEventKey } from "../zones.js";
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
  return `${e.verb}|${one(s.type)}|${one(s.subtype)}|${tokenOf(s.token)}`;
}

/** WHETHER THE EVENT IS ABOUT A TOKEN: `t` yes, `n` no, `-` not stated.
 *
 *  MEASURED 2026-09-04 and it is why this is a dimension rather than a footnote: 59 corpus cards
 *  trigger specifically on a TOKEN entering (Xorn, Mirkwood Bats, Caretaker's Talent) and 206
 *  triggers demand a NONTOKEN one. Without the flag both keyed as plain `enters|creature|-`, so a
 *  token maker's page ranked "whenever a token enters" level with "whenever a creature enters" --
 *  the payoff built for exactly this card, priced as though it were generic -- while the nontoken
 *  payoffs it can never satisfy sat in its candidate list until the engine threw them out one by
 *  one. */
const tokenOf = (v: boolean | null | undefined): string => v === true ? "t" : v === false ? "n" : "-";

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

/** THE FORMS AN EMIT CAN SATISFY. A type or subtype LIST is a disjunction, so it splits; then each
 *  split form also stands for its coarser shapes, because a goblin creature entering satisfies a
 *  demand for a creature entering, for a goblin entering, and for anything entering. */
export function supplyForms(key: string): string[] {
  const out = new Set<string>();
  for (const [verb, type, subtype, token] of splitList(key)) {
    // WHAT THIS SUPPLY CAN BE, and "not stated" is read as NOT A TOKEN.
    //
    // The alternative -- unspecified as a wildcard that satisfies a token demand too -- keeps every
    // edge that exists today and buys nothing: a token demand would then be satisfiable by almost
    // the whole corpus, score as broadly as an untyped one, and rank no higher than it does now,
    // which is the defect this dimension exists to fix.
    //
    // MEASURED before choosing: of 27,653 authored emits, 6,810 say token and 84 say nontoken; on
    // the `enters` verb specifically it is 3,309 token against 1,803 unstated. Token-making is
    // derived EXPLICITLY, so an unstated `enters` is overwhelmingly a real card being put onto the
    // battlefield -- a reanimation, a blink -- and reading it as "might be a token" would feed every
    // token payoff from every reanimator. The cost of this reading is a missing edge wherever a
    // token emit was derived without its flag, which is the direction this repo fails in.
    const suffixes = token === "t" ? ["t", "-"] : ["n", "-"];
    for (const tk of suffixes) {
      out.add(`${verb}|${type}|${subtype}|${tk}`);
      out.add(`${verb}|${type}|-|${tk}`);
      out.add(`${verb}|-|${subtype}|${tk}`);
      out.add(`${verb}|-|-|${tk}`);
    }
  }
  return [...out];
}

/** THE FORMS A DEMAND ACCEPTS -- the list split, and NOTHING ELSE.
 *
 *  A demand is NEVER generalised upward. `enters|-|goblin` means a goblin entering; widening it to
 *  `enters|-|-` would count every permanent in the game as satisfying it, which is precisely the
 *  bug this file was rewritten to remove. */
export function demandForms(key: string): string[] {
  // THE TOKEN FLAG NEVER WIDENS EITHER. A trigger that says "a nontoken creature" is asking a
  // narrower question than one that says "a creature", and answering it with a token is the wrong
  // answer rather than a generous one -- 206 triggers in the corpus say exactly that, and every one
  // of them used to sit in a token maker's candidate list waiting for the engine to refuse it.
  return [...new Set(splitList(key).map(([v, t, st, tk]) => `${v}|${t}|${st}|${tk}`))];
}

const splitList = (key: string): [string, string, string, string][] => {
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");
  const out: [string, string, string, string][] = [];
  for (const t of type.split(",")) for (const st of subtype.split(",")) out.push([verb, t, st, token]);
  return out;
};

/** HOW MANY CARDS IN THE CORPUS CAN ACTUALLY SATISFY EACH DEMAND.
 *
 *  THIS REPLACED A COUNT OF IDENTICAL KEY STRINGS, WHICH WAS MEASURABLY WRONG. Key-string rarity is
 *  an artifact of how a demand was WRITTEN, not of how narrow it is:
 *  `enters|battle,creature,enchantment,land,planeswalker|-` fires on essentially any permanent, yet
 *  that exact string appears almost nowhere, so it scored maximally and won the #1 slot for 1,402
 *  cards. `counter-added|enchantment|incarnation` won for 1,995. Measured over the real corpus
 *  2026-09-04, which is the only reason it was caught.
 *
 *  Counting SUPPLIERS fixes both, and fixes a third thing for free: every permanent implicitly emits
 *  "I enter", so a "when a permanent enters" demand is satisfied by nearly the whole corpus, scores
 *  near zero, and stops crowding out real interactions -- without a special case. That is the
 *  engine's own "playing Magic is not a synergy" rule falling out of the arithmetic. */
export function supplyCounts(rows: Iterable<{ emits: string[]; demands: string[] }>): EventFrequency {
  const list = [...rows];
  const suppliersOf = new Map<string, Set<number>>();
  list.forEach((r, i) => {
    for (const form of new Set(r.emits.flatMap(supplyForms))) {
      const set = suppliersOf.get(form);
      if (set) set.add(i); else suppliersOf.set(form, new Set([i]));
    }
  });
  const out: EventFrequency = {};
  for (const demand of new Set(list.flatMap((r) => r.demands))) {
    const union = new Set<number>();
    for (const form of demandForms(demand)) {
      for (const i of suppliersOf.get(form) ?? []) union.add(i);
    }
    out[demand] = union.size;
  }
  return out;
}

/** ONE CARD'S OWN EVENTS, ONTO THE DECK-LEVEL ARCHETYPE NAMES.
 *
 *  `detectArchetypes` cannot answer this. It is deck-level and density-based -- `ARCHETYPE_FLOOR` is
 *  0.08 of the nonlands -- and a single card has no density to measure. This is the same taxonomy
 *  read at the only resolution a card page has.
 *
 *  KEYED ON THE VERB, AND ON THE TYPE ONLY WHERE THE SIGNATURE ALREADY DOES. `ARCHETYPE_SIGNATURE`
 *  spells its tags as `verb:subject` while an event key is `verb|type|subtype`, and the two subject
 *  halves are not the same string -- `create-token:any` against `create-token|creature|goblin`. The
 *  verb is what actually carries the archetype in every row but two, and Landfall and Spellslinger
 *  are the two, so they keep their type.
 *
 *  ARISTOCRATS IS DEMAND-DEFINED, honoured here rather than re-decided: an aristocrats deck is its
 *  PAYOFFS, not the removal spell that emits `sacrifice:creature`. Measured over the 71 decks, 815
 *  of 974 matches were supply-only and Aristocrats topped four decks the owner calls Control.
 *
 *  RETURNS EVERY LABEL THAT FITS, which is a deliberate deviation from the plan's `string | null`.
 *  A commander that makes tokens AND puts counters on things is both; picking one would need a
 *  priority order nothing here has measured, and inventing one is the guess this layer exists to
 *  refuse. An empty array is "no signature", which is a real answer and the common one. */
const SUPPLY_THEMES: [prefix: string, archetype: Archetype][] = [
  ["create-token|", "tokens"],
  ["gain-life|", "lifegain"],
  ["enters|land|", "landfall"],
  ["cast|instant", "spellslinger"],
  ["cast|sorcery", "spellslinger"],
  ["counter-added|", "counters"],
  ["proliferate|", "counters"],
];
const DEMAND_THEMES: [prefix: string, archetype: Archetype][] = [
  ["dies|", "aristocrats"],
  ["sacrifice|", "aristocrats"],
];

export function themesOf(emits: string[], demands: string[]): string[] {
  const hit = new Set<Archetype>();
  for (const [prefix, archetype] of SUPPLY_THEMES) {
    if (emits.some((e) => e.startsWith(prefix))) hit.add(archetype);
  }
  for (const [prefix, archetype] of DEMAND_THEMES) {
    if (demands.some((d) => d.startsWith(prefix))) hit.add(archetype);
  }
  // Signature order, not insertion order: two cards with the same pair of labels must print them
  // the same way round.
  const order = [...SUPPLY_THEMES, ...DEMAND_THEMES].map(([, a]) => a);
  return [...hit].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((a) => ARCHETYPE_LABELS[a]);
}

/** THE DEMANDS THE CARD DOES NOT ANSWER ITSELF -- what a deck built around it has to bring.
 *
 *  A commander that watches creatures die and kills none is stating a requirement. One that does
 *  both is self-sufficient on that event, and listing it as a gap would be a page telling a reader
 *  to go find something they already have.
 *
 *  THE SAME SUPPLY/DEMAND PREDICATE `partnersFor` RANKS WITH, so the two cannot disagree about what
 *  satisfies what: a goblin token entering really is a creature entering. */
export function unmetDemands(emits: string[], demands: string[]): string[] {
  const supplied = new Set(emits.flatMap(supplyForms));
  return demands.filter((d) => !demandForms(d).some((f) => supplied.has(f)));
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

/** HOW MANY ROWS ONE EVENT MAY OCCUPY.
 *
 *  MEASURED, 2026-09-04: ~2,000 cards demand `enters|creature|-`. They score IDENTICALLY, because
 *  they are identically specific, so which of them reached a page was decided by corpus iteration
 *  order -- Impact Tremors lost a slot to Diregraf Horde for no reason a reader could name.
 *
 *  Capping is the fix rather than a tie-break, because there is no honest tie-break available: the
 *  cards really are equally specific, and the only orderings that would separate them are quality
 *  or popularity, neither of which this engine will assert. Twenty rows that all say "triggers when
 *  a creature enters" are ONE fact printed twenty times; three of them plus a count says the same
 *  thing and leaves room for the card's other interactions. `pool` carries the count. */
export const PER_EVENT_CAP = 3;

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
export interface PartnerResult {
  rows: PartnerRow[];
  /** Per event key, how many cards in the corpus demand something this card supplies. The rows are
   *  capped; this is what the page says instead of padding -- "and 1,974 more trigger on a creature
   *  entering". A CANDIDATE count, not a verified-edge count, and the page must word it that way. */
  pool: Record<string, number>;
}

export function partnersFor(
  subject: DeckCard,
  candidates: DeckCard[],
  feeders: DeckCard[],
  freq: EventFrequency,
  slugs: Map<string, string>,
  h: Hierarchy,
): PartnerResult {
  // EVERY DEMAND SHAPE THIS CARD'S EMITS CAN SATISFY. `supplyForms` splits type lists and adds the
  // coarser shapes, so a goblin-token emit is found by a demand for a creature entering.
  // WHAT THE SUBJECT SUPPLIES, WHICH INCLUDES WHAT IT IS. A Goblin body supplies "a Goblin you
  // control" by being one, so a payoff that counts Goblins is a candidate for it -- the relation
  // `edges.ts` draws and no event can express.
  const subjectEmits = new Set(supplyKeysOf(subject).flatMap(supplyForms));

  const ranked = candidates
    // A CARD IS NEVER ITS OWN PARTNER. `directedReasons(x, x)` can return reasons, and
    // self-reference is the largest defect family this engine has had -- 74% of all false edges --
    // so the exclusion is explicit rather than left to the reason layer.
    .filter((c) => c.card.name !== subject.card.name)
    .map((c) => {
      // EVERY EVENT THE PAIR COULD CONNECT THROUGH, not just the best one. The best RANKS the
      // candidate; which one PRICES the row is decided after the engine has spoken, because a pair
      // usually shares several demand keys and the engine confirms some and refuses others.
      const events = new Map<string, { score: number; tags: Set<string> }>();
      for (const a of c.tags?.abilities ?? []) {
        for (const verb of a.trigger?.verbs ?? []) {
          const key = eventKey({ verb, subject: a.trigger!.subject } as GameEvent);
          // THE DEMAND ONLY SPLITS, IT NEVER WIDENS -- the same asymmetry `supplyCounts` relies on.
          // Widening it here would admit every permanent as a candidate for a goblin demand, and the
          // score is taken on the demand's own key, so a widened match would also be mispriced.
          if (!demandForms(key).some((f) => subjectEmits.has(f))) continue;
          // THE ENGINE'S OWN TAG FOR THIS DEMAND, built from the same trigger by the same two
          // functions `directedReasons` uses, so "did the engine confirm THIS event" is string
          // equality against what the engine wrote. Comparing verbs instead was a near miss twice
          // over: `zoneEventKey` renames a graveyard entry and a battlefield departure while
          // `eventKey` drops the zone, and a verb-only test cannot tell `enters:goblin` from
          // `enters:creature`, so a generic sentence would be priced at the rare demand's rate.
          const t = normalizeZoneEvent({ verb, subject: a.trigger!.subject } as GameEvent);
          const tag = zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject));
          const e = events.get(key) ?? { score: specificity(key, freq), tags: new Set<string>() };
          e.tags.add(tag);
          events.set(key, e);
        }
      }
      const byScore = [...events].sort((a, b) => b[1].score - a[1].score);
      return { card: c, events: byScore, score: byScore[0]?.[1].score ?? 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // COUNTED BEFORE THE CUT, so the page can say how many it is not showing. Counted over EVERY
  // event a candidate matched rather than only its best, because any of them can end up pricing a
  // row -- a pool keyed on the best alone would leave a row's own event uncounted.
  const pool: Record<string, number> = {};
  for (const r of ranked) for (const [key] of r.events) pool[key] = (pool[key] ?? 0) + 1;

  const rows: PartnerRow[] = [];
  const shown: Record<string, number> = {};
  for (const r of ranked.slice(0, VERIFY_LIMIT)) {
    // NO TOKEN NODE EXISTS ON A CARD PAGE, so the engine's token suppression would trade this
    // card's real supply for a second hop that is never built. See `ReasonOptions.tokensMediate`.
    const reasons = directedReasons(subject, r.card, h, { tokensMediate: false });
    if (reasons.length === 0) continue;
    // THE ROW IS PRICED ON AN EVENT THE ENGINE ACTUALLY CONFIRMED.
    //
    // MEASURED, 2026-09-04: verifying the PAIR while scoring the EVENT let an event that formed no
    // edge set the price and the label. 10,411 of 88,768 rows (11.7%) carried no sentence for their
    // own event at all -- the pair connects, but through some other channel, so the number beside
    // the row was earned by a relation the engine had refused. The candidate's events are tried
    // highest-specificity first and the first one the reasons support wins; a candidate none of
    // them support is dropped rather than priced on a refusal.
    const hit = r.events.map(([event, { score, tags }]) => ({ event, score, on: reasons.filter((x) => tags.has(x.tag)) }))
      .find((e) => e.on.length > 0);
    if (!hit) continue;
    if ((shown[hit.event] ?? 0) >= PER_EVENT_CAP) continue;
    shown[hit.event] = (shown[hit.event] ?? 0) + 1;
    rows.push({
      name: r.card.card.name,
      slug: slugs.get(r.card.card.name) ?? slugOf(r.card.card.name),
      score: hit.score,
      event: hit.event,
      reason: pickReason(hit.on),
    });
    if (rows.length === KEEP) break;
  }
  // THE ROWS THAT RUN THE OTHER WAY. Everything above is "this card supplies, that card consumes".
  // A BOARD COUNT IS THE REVERSE: Krenko, Mob Boss counts Goblins, so the Goblins feed HIM and the
  // pair is verified `feeder -> subject`. Without this phase the engine drew the edge and the page
  // never asked about it -- the ranking proposes candidates by event key, and a board count has an
  // event on neither side.
  //
  // ONE LIST, NOT TWO SECTIONS: the engine's own sentence names both cards and says which way it
  // runs ("While Goblin Assassin is on the battlefield, Krenko, Mob Boss counts it and gets
  // bigger"), so the row itself tells a reader the direction.
  for (const key of boardCountKeysOf(subject)) {
    const score = specificity(key, freq);
    const usable = feeders.filter((f) => f.card.name !== subject.card.name);
    for (const f of usable) {
      if ((shown[key] ?? 0) >= PER_EVENT_CAP || rows.length >= KEEP) break;
      const slug = slugs.get(f.card.name) ?? slugOf(f.card.name);
      if (rows.some((r) => r.slug === slug)) continue;
      // VERIFIED THE WAY EVERY OTHER ROW IS, just in the other direction: the engine decides whether
      // the relation exists and writes the sentence.
      const on = directedReasons(f, subject, h, { tokensMediate: false })
        .filter((r) => r.tag === `scales:${key.split("|")[2]}`);
      if (on.length === 0) continue;
      shown[key] = (shown[key] ?? 0) + 1;
      rows.push({ name: f.card.name, slug, score, event: key, reason: pickReason(on) });
    }
    // COUNTED BEFORE THE CUT, like every other pool: how many cards in the corpus are one of these.
    pool[key] = usable.length;
  }

  // A ROW CAN NOW BE PRICED BELOW THE SCORE THAT RANKED IT, so the order the loop produced is no
  // longer the order the page wants. Sorting here rather than re-ranking keeps the CEILING above
  // honest: `VERIFY_LIMIT` still cuts on the best-possible score, which is the only score known
  // before the engine runs.
  rows.sort((a, b) => b.score - a.score);
  return { rows, pool };
}

/** WHICH OF THE ENGINE'S SENTENCES TO STORE.
 *
 *  MEASURED, 2026-09-04: Krenko's row read "When Krenko, Mob Boss enters, Quest for the Goblin Lord
 *  puts counters on it" -- Krenko entering ONCE, as a body. His actual engine, tapping to make
 *  goblins repeatedly, satisfies the same trigger and is the half worth printing. `reasons[0]` was
 *  simply whichever the engine emitted first.
 *
 *  IT IS HANDED ONLY THE SENTENCES FOR THE ROW'S OWN EVENT, because preferring
 *  repeatability across all of them was measurably wrong: **11,928 of 88,768 rows (13.4%) printed
 *  an event key beside a sentence about a different channel** -- a row labelled `dies|-|-` reading
 *  "When Wild Magic Surge is cast, Sedgemoor Witch makes a token". Both halves can be true and the
 *  page still contradicts itself, because `event` is what earned the score and the sentence is what
 *  the reader checks it against.
 *
 *  A REPEATABLE REASON BEATS A ONE-SHOT, and nothing else is reordered: this picks between
 *  sentences the engine already wrote, it never composes one and never promotes a pair the engine
 *  refused. */
function pickReason(reasons: { text: string; repeatability?: string; impliedProducer?: boolean }[]): string {
  // AN AUTHORED SUPPLY OUTRANKS THE BASELINE ONE, and it outranks repeatability too. Krenko is a
  // Goblin AND he taps to make Goblins, so he satisfies `enters:goblin` twice; both sentences carry
  // the consumer's own repeatability, so that rule cannot separate them and the body's -- "When
  // Krenko, Mob Boss enters" -- won on emission order. `impliedProducer` marks the baseline the
  // matcher synthesises for a card merely existing; the authored emit is the engine the reader came
  // to the page for. MEASURED 2026-09-04: 6,407 rows on 1,714 cards printed the body's sentence.
  const rank = (r: { repeatability?: string; impliedProducer?: boolean }) =>
    (r.impliedProducer === true ? 2 : 0) + (r.repeatability && r.repeatability !== "oneshot" ? 0 : 1);
  return reasons.reduce((best, r) => (rank(r) < rank(best) ? r : best)).text;
}


/** Re-exported so every existing importer keeps working; the definition moved to its own file
 *  because the Pages Function needs the shard rule without `edges.ts` behind it. */
export { PARTNER_SHARD_COUNT, partnerShardOf };

export const emitKeysOf = (d: DeckCard): string[] =>
  (d.tags?.abilities ?? []).flatMap((a) => (a.emits ?? []).map(eventKey));

export const demandKeysOf = (d: DeckCard): string[] => [
  ...(d.tags?.abilities ?? []).flatMap((a) =>
    (a.trigger?.verbs ?? []).map((v) => eventKey({ verb: v, subject: a.trigger!.subject } as GameEvent))),
  ...boardCountKeysOf(d),
];

/** THE FIVE BASIC LAND TYPES, which a board count may name and which never form a row -- the same
 *  refusal `edges.ts` makes for the same reason: a mono-black deck runs thirty Swamps, and thirty
 *  rows into one payoff is a mesh, not a synergy. */
const BASIC_LAND_TYPES = new Set(["plains", "island", "swamp", "mountain", "forest"]);

/** WHAT A CARD COUNTS ON THE BOARD, as a demand key.
 *
 *  Krenko, Mob Boss makes a Goblin token per Goblin you control. That is a demand on the other 99
 *  cards and it fires nothing -- no trigger, no emit -- so until this existed his record's
 *  `demands` was EMPTY and his page could not answer the question his deck is built around.
 *
 *  ONLY A SUBTYPE, AND NEVER A BASIC LAND TYPE. `edges.ts` refuses a bare card type on the same
 *  ground ("creatures you control" is satisfied by every creature in the deck), and a key the
 *  matcher would refuse is a row the page must not offer. The two gates state the same rule and are
 *  tested against each other. */
export const boardCountKeysOf = (d: DeckCard): string[] => [...new Set(
  (d.tags?.abilities ?? []).flatMap((a) => {
    const counted = a.effect?.scalingSubject;
    if (!counted || counted.zone !== "battlefield" || counted.control === "opp") return [];
    const subtype = Array.isArray(counted.subtype) ? counted.subtype[0] : counted.subtype;
    if (subtype === undefined || BASIC_LAND_TYPES.has(subtype)) return [];
    return [`counts|-|${subtype}|-`];
  }),
)];

/** WHAT A CARD IS, as a supply key -- its own printed subtypes.
 *
 *  A Goblin body supplies "a Goblin you control" simply by being one, which is what lets the
 *  existing candidate index and frequency table price a board count with no new machinery: the
 *  rarity of `counts|-|goblin|-` is the number of Goblins in the corpus, exactly as the rarity of
 *  an event is the number of cards that can cause it.
 *
 *  KEPT OUT OF THE RECORD'S `emits`. This is a supply the RANKING uses, not a claim the page should
 *  print: "what it produces" would fill with a restatement of the card's own type line on all
 *  15,350 records. */
export const supplyKeysOf = (d: DeckCard): string[] => [
  ...emitKeysOf(d),
  ...(d.tags?.characteristics.subtypes ?? [])
    .filter((t) => !BASIC_LAND_TYPES.has(t))
    .map((t) => `counts|-|${t}|-`),
];

/** SUBSTANTIVE = at least one emit or one trigger.
 *
 *  This one predicate decides three things at once: which cards get a partner record, which get an
 *  indexable page, and what the sitemap promises. A card with abilities but neither an emit nor a
 *  trigger -- a static, a keyword-only body -- forms no edge, so its page makes no promise to a
 *  crawler even though it still renders. */
export const isSubstantive = (d: DeckCard): boolean =>
  emitKeysOf(d).length > 0 || demandKeysOf(d).length > 0;

/** NO CARD RULES TEXT (spec D2, reversed 2026-09-04). Name, type line and mana cost are card
 *  METADATA and the page is unusable without them; the RULES text is absent entirely.
 *
 *  The evidence a reader checks a claim against is `PartnerRow.reason` -- the engine's own sentence,
 *  naming both cards -- not the card's printed text. Quoting the card would add nothing to that
 *  argument and would only make the page resemble a card database, which is what Scryfall's
 *  "may not simply repackage, republish, or proxy" clause is about. */
export interface CardPageRecord {
  name: string;
  typeLine: string;
  manaCost: string | null;
  identity: string[];
  commander: boolean;
  emits: string[];
  demands: string[];
  partners: PartnerRow[];
  /** Per event key, how many cards demand something this card supplies -- what the page says in
   *  place of the rows `PER_EVENT_CAP` withheld. */
  pool: Record<string, number>;
  /** THE SAME LIST OVER THE CARDS THIS COMMANDER'S DECK COULD LEGALLY CONTAIN, on commander records
   *  only. A deck led by a mono-red card can never play a Simic payoff, so a partner list that
   *  ignores colour identity is a list of cards that will never be in the same deck.
   *
   *  RANKED OVER THE LEGAL POOL, NOT FILTERED AFTER RANKING. Filtering afterwards leaves a mono-red
   *  commander showing eight of its twenty-four rows with nothing to fill the rest; re-ranking
   *  fills them with legal cards, which is also what makes `/commanders/:slug` differ in SUBSTANCE
   *  from `/cards/:slug` rather than being a thinner view of it (spec D5, duplicate content).
   *
   *  ABSENT ON EVERY OTHER RECORD: 12,927 of the 15,350 cards can never lead a deck, and every
   *  record pays the bytes of every field it carries. */
  commanderPartners?: PartnerRow[];
  commanderPool?: Record<string, number>;
}

export interface NameIndexEntry {
  slug: string;
  name: string;
  identity: string[];
  commander: boolean;
}

export interface PartnerArtifact {
  shards: Map<string, Record<string, CardPageRecord>>;
  freq: EventFrequency;
  index: NameIndexEntry[];
}

/** A COMMANDER, for the purposes of the `/commanders` pages. Legendary creatures only: the
 *  "can be your commander" planeswalkers and backgrounds are a larger question than this artifact
 *  needs, and shipping a wrong commander list is worse than shipping a short one.
 *  CEILING: no planeswalker commanders, no backgrounds. Upgrade path: read the rules text for the
 *  "can be your commander" line, which the corpus has. */
const isCommander = (d: DeckCard): boolean =>
  /Legendary Creature/.test(d.card.typeLine ?? "")
  && (d.card as { legalities?: Record<string, string> }).legalities?.commander === "legal";

/** THE WHOLE ARTIFACT, PURELY. Mongo reads and fs writes stay in `build-static.ts`; everything
 *  decidable is here so it can be tested without either. */
export function buildPartnerArtifact(all: DeckCard[], h: Hierarchy): PartnerArtifact {
  const substantive = all.filter(isSubstantive);
  const slugs = resolveSlugs(substantive.map((d) => d.card.name));
  const freq = supplyCounts(
    substantive.map((d) => ({ emits: supplyKeysOf(d), demands: demandKeysOf(d) })),
  );

  // CANDIDATES BY DEMAND KEY, INCLUDING THE COARSER FORMS. Without this index every card would be
  // compared against all ~14,900 and the build is quadratic before `partnersFor` can bound it. A
  // card is filed under every variant of every demand it has, so a subject emitting the specific
  // form finds it and so does one emitting the general form.
  const byDemand = new Map<string, DeckCard[]>();
  for (const d of substantive) {
    for (const k of new Set(demandKeysOf(d).flatMap(demandForms))) {
      const b = byDemand.get(k);
      if (b) b.push(d); else byDemand.set(k, [d]);
    }
  }
  // THE MIRROR INDEX, AND ONLY FOR BOARD COUNTS. A card that COUNTS Goblins needs the Goblins, and
  // they are found by what they ARE rather than by what they demand. Restricted to `counts|` keys:
  // indexing every card by every event it supplies would be the quadratic build this file avoids.
  const bySubtype = new Map<string, DeckCard[]>();
  for (const d of substantive) {
    for (const k of supplyKeysOf(d)) {
      if (!k.startsWith("counts|")) continue;
      const b = bySubtype.get(k);
      if (b) b.push(d); else bySubtype.set(k, [d]);
    }
  }

  const shards = new Map<string, Record<string, CardPageRecord>>();
  const index: NameIndexEntry[] = [];

  for (const d of substantive) {
    const slug = slugs.get(d.card.name)!;
    const emits = emitKeysOf(d);
    // CANDIDATES COME FROM WHAT THE CARD SUPPLIES, WHICH INCLUDES WHAT IT IS. `emits` is what the
    // record PRINTS; `supplyKeysOf` is what the ranking may ask about, and the difference is the
    // card's own subtypes -- a Goblin body is a candidate for every payoff that counts Goblins.
    const candidates = [...new Set(supplyKeysOf(d).flatMap(supplyForms).flatMap((k) => byDemand.get(k) ?? []))];
    const feeders = [...new Set(boardCountKeysOf(d).flatMap((k) => bySubtype.get(k) ?? []))];
    const commander = isCommander(d);

    const shardName = partnerShardOf(slug);
    const shard = shards.get(shardName) ?? {};
    shard[slug] = {
      name: d.card.name,
      typeLine: d.card.typeLine ?? "",
      manaCost: (d.card as { manaCost?: string }).manaCost ?? null,
      identity: d.card.colorIdentity ?? [],
      commander,
      emits: [...new Set(emits)],
      demands: [...new Set(demandKeysOf(d))],
      ...(() => { const { rows, pool } = partnersFor(d, candidates, feeders, freq, slugs, h);
        return { partners: rows, pool }; })(),
      // A CARD IS LEGAL IN A DECK WHEN ITS WHOLE IDENTITY SITS INSIDE THE COMMANDER'S -- the same
      // rule `legality.ts` reports a violation against. An empty identity is inside every one,
      // which is why a colourless card belongs in every deck and `every` over `[]` says so.
      ...(commander ? (() => {
        const identity = new Set(d.card.colorIdentity ?? []);
        const legal = candidates.filter((c) => (c.card.colorIdentity ?? []).every((x) => identity.has(x)));
        const legalFeeders = feeders.filter((c) => (c.card.colorIdentity ?? []).every((x) => identity.has(x)));
        const { rows, pool } = partnersFor(d, legal, legalFeeders, freq, slugs, h);
        return { commanderPartners: rows, commanderPool: pool };
      })() : {}),
    };
    shards.set(shardName, shard);
    index.push({ slug, name: d.card.name, identity: d.card.colorIdentity ?? [], commander });
  }

  return { shards, freq, index };
}
