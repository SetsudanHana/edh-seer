import type { CardTags, GameEvent } from "@edh-seer/tagger";
import type { Card } from "@edh-seer/engine";
import { ARCHETYPE_LABELS, type Archetype } from "../archetypes.js";
import { PARTNER_SHARD_COUNT, partnerShardOf } from "../partner-shard.js";
import { ROLE_NOT_SYNERGY, directedReasons, meldReason, themeSubjectKey } from "../edges.js";
import { keywordAbilities } from "../implied.js";
import { ALL_CARD_TYPES, PSEUDO_TYPE_SETS } from "../hierarchy.js";
import { choosesColour, isBackground as isBackgroundCard, isLegalCommander, pairingLicense } from "../legality.js";
/** Re-exported for the card pages' ability table: an effect kind is engine vocabulary
 *  (`token-generation`) and `effectPhrase` is where this repo already turned every one of them into
 *  English. A second map in the client is how two surfaces start disagreeing about what a kind means. */
export { effectPhrase } from "../sentence.js";
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
    const suffixes = token === "t" ? ["t", "-"] : ["n", "-"];
    // THE VERBS THE ENGINE LETS THIS SUPPLY SATISFY, mirrored from `verbSatisfies` in edges.ts,
    // because the page proposes a pair by key BEFORE the engine verifies it: a bridge that lives
    // only in the engine is a pair the page never asks about. A death is one kind of leave
    // (CR 700.4); damage aimed at a player -- no type, no subtype -- is life loss (CR 120.3).
    // Lightning Bolt's page listed three damage payoffs and no life-loss one (2026-09-05).
    const verbs = [verb,
      ...(verb === "dies" ? ["leaves"] : []),
      ...(verb === "non-combat-damage" && type === "-" && subtype === "-" ? ["lose-life"] : [])];
    for (const v of verbs) for (const tk of suffixes) {
      out.add(`${v}|${type}|${subtype}|${tk}`);
      out.add(`${v}|${type}|-|${tk}`);
      out.add(`${v}|-|${subtype}|${tk}`);
      out.add(`${v}|-|-|${tk}`);
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
  /** THE HALF OF THE SENTENCE THE HEADING DOES NOT ALREADY SAY.
   *
   *  Every row under one group opened with the same 60 characters -- "When a Goblin enters thanks to
   *  Krenko, Mob Boss," ten times over -- because the group heading states the event and then each
   *  sentence restates it. A design review measured roughly 60% of the section as repetition, with
   *  the only new information, the payoff, pushed to the end of every line.
   *
   *  COMPUTED FROM THE ENGINE'S OWN SENTENCE, never composed: the tail after ", <partner name> " is
   *  what that card does, in the words the engine already chose. `reason` is kept in full because
   *  the deck report prints it and because a reader who wants the whole claim should still be able
   *  to get it.
   *
   *  ABSENT ON A FEEDER ROW. Those run the other way -- "While you control Taster of Wares, Krenko
   *  counts it and makes more tokens" -- so the tail describes the SUBJECT, not the row's card, and
   *  collapsing it would put Krenko's behaviour under Taster of Wares' name. */
  payoff?: string;
  /** THE ENGINE DID NOT READ WHAT THIS CARD DOES, so its sentence ends at "triggers".
   *
   *  MEASURED 2026-09-04: 3,453 consumer abilities in the corpus carry no effect kind at all. Their
   *  rows used to be indistinguishable from the informative ones -- same typeface, same shape, no
   *  marker -- which a skeptic called a refusal that reads as a hole. A limit the page states is
   *  honest; a limit it hides is not. */
  unread?: true;
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
  /** Per event key, how many cards in the corpus can CAUSE it -- which is the number the ranking is
   *  computed from, and a different population from `pool`.
   *
   *  THE PAGE WAS SHOWING ONE NUMBER AND RANKING ON THE OTHER. A skeptic reconstructed the order
   *  from the only figure on screen and found it non-monotonic -- 2, 263, 1, 3, 1863, 15 -- and
   *  concluded the ranking was broken. It was not: in THIS number the same groups read 72, 264,
   *  2159, 2159, 2879, 2963, descending exactly as claimed. The reasoning was sound and the evidence
   *  was missing, which is the page's fault and not the reader's. */
  rarity: Record<string, number>;
}

/** The tail of the engine's sentence after ", <name> " -- what the row's own card does. Returns
 *  nothing when the sentence does not have that shape, which is the honest failure: a row with no
 *  payoff keeps the full sentence rather than showing a guess at half of it. */
const payoffOf = (reason: string, name: string): { payoff?: string } => {
  const at = reason.indexOf(`, ${name} `);
  if (at < 0) return {};
  return { payoff: reason.slice(at + name.length + 3) };
};

export function partnersFor(
  subject: DeckCard,
  candidates: DeckCard[],
  feeders: DeckCard[],
  freq: EventFrequency,
  slugs: Map<string, string>,
  h: Hierarchy,
  /** The card this one melds with, when it is in the pool -- the one candidate no key can find. */
  meldWith?: DeckCard,
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
      for (const a of abilitiesOf(c)) {
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
    const chosen = pickReason(hit.on);
    rows.push({
      name: r.card.card.name,
      slug: slugs.get(r.card.card.name)!,
      score: hit.score,
      event: hit.event,
      reason: chosen.text,
      ...payoffOf(chosen.text, r.card.card.name),
      ...(chosen.effectKind ? {} : { unread: true as const }),
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
  for (const { key, tag } of boardCountsOf(subject)) {
    if (key in pool) continue;
    const score = specificity(key, freq);
    // A FEEDER SITS UNDER THE KEY IT SUPPLIES. A party count has four keys and the engine confirms
    // a Rogue under any of them (an array subtype is OR), so without this every feeder landed under
    // the first key and the page said "a Cleric you control" over a Rogue.
    const usable = feeders.filter((f) => f.card.name !== subject.card.name && supplyKeysOf(f).includes(key));
    for (const f of usable) {
      if ((shown[key] ?? 0) >= PER_EVENT_CAP || rows.length >= KEEP) break;
      const slug = slugs.get(f.card.name)!;
      if (rows.some((r) => r.slug === slug)) continue;
      // VERIFIED THE WAY EVERY OTHER ROW IS, just in the other direction: the engine decides whether
      // the relation exists and writes the sentence.
      const on = directedReasons(f, subject, h, { tokensMediate: false })
        .filter((r) => r.tag === tag);
      if (on.length === 0) continue;
      shown[key] = (shown[key] ?? 0) + 1;
      const chosen = pickReason(on);
      rows.push({
        name: f.card.name, slug, score, event: key, reason: chosen.text,
        ...(chosen.effectKind ? {} : { unread: true as const }),
      });
    }
    // COUNTED BEFORE THE CUT, like every other pool: how many cards in the corpus are one of these.
    pool[key] = usable.length;
  }

  // THE ROWS A STATIC REACHES. Neither direction above can find them: a static emits nothing and
  // counts nothing. Candidates are what the key names (`staticReaches`), ranked by HOW MANY of the
  // subject's statics land on them so the card both statics reach is asked about first, and then
  // verified exactly as every other row is -- the engine's static pass decides, on the tag it
  // writes, and a candidate it refuses (a land under a discount, a `{U}` spell under a generic one)
  // is counted in the pool and dropped from the rows.
  const staticKeys = staticKeysOf(subject);
  if (staticKeys.length > 0) {
    const hits = candidates
      .filter((c) => c.card.name !== subject.card.name)
      .map((c) => ({ c, matched: staticKeys.filter((k) => staticReaches(k, c)) }))
      .filter((x) => x.matched.length > 0)
      // CEILING: among cards the same statics reach, the order is corpus order -- a discount on
      // every noncreature spell reaches five thousand cards and the page shows three, and on
      // 2026-09-05 that put Lattice Library ahead of Raise the Alarm. An EDHREC-rank tie-break was
      // built, passed, and REVERTED the same hour against the rule recorded on `specificity`:
      // popularity is not synergy and `edhrecRank` is consulted nowhere downstream of it. The
      // upgrade path is a second synergy signal (how many of the CANDIDATE's own emits the subject
      // answers), not a play-rate.
      .sort((a, b) => b.matched.length - a.matched.length);
    for (const key of staticKeys) pool[key] = hits.filter((x) => x.matched.includes(key)).length;
    for (const { c, matched } of hits.slice(0, VERIFY_LIMIT)) {
      if (rows.length >= KEEP) break;
      const slug = slugs.get(c.card.name)!;
      if (rows.some((r) => r.slug === slug)) continue;
      const reasons = directedReasons(subject, c, h, { tokensMediate: false });
      for (const key of matched) {
        if ((shown[key] ?? 0) >= PER_EVENT_CAP) continue;
        const on = reasons.filter((r) => r.tag === `static:${splitStaticKey(key).kind}`);
        if (on.length === 0) continue;
        shown[key] = (shown[key] ?? 0) + 1;
        const chosen = pickReason(on);
        rows.push({
          name: c.card.name, slug, score: specificity(key, freq), event: key, reason: chosen.text,
          ...payoffOf(chosen.text, c.card.name),
          ...(chosen.effectKind ? {} : { unread: true as const }),
        });
        break;
      }
    }
  }

  // THE OTHER HALF OF A MELD PAIR. One candidate, named on the card, verified exactly as every
  // other row is: the engine's `meldReason` decides, on the `meld` tag it writes.
  // NOT BEHIND `KEEP`: a rarity of one sorts it to the top below, so a card that already has 24
  // rows would otherwise drop its one meld silently.
  if (meldWith) {
    const key = "meld|-|-|-";
    pool[key] = 1;
    // `meldReason` lives beside `directedReasons` in `pairReasons`, not inside it: a meld is
    // symmetric and stated once per pair, so it is asked for by name here. NEVER `unread`: the
    // reason carries no effect kind BY DESIGN (melding is not a payoff kind), and the sentence is
    // the whole of what the engine read.
    const on = meldReason(subject, meldWith);
    if (on.length > 0) {
      rows.push({
        name: meldWith.card.name, slug: slugs.get(meldWith.card.name)!,
        score: specificity(key, freq), event: key, reason: pickReason(on).text,
      });
    }
  }

  // A ROW CAN NOW BE PRICED BELOW THE SCORE THAT RANKED IT, so the order the loop produced is no
  // longer the order the page wants. Sorting here rather than re-ranking keeps the CEILING above
  // honest: `VERIFY_LIMIT` still cuts on the best-possible score, which is the only score known
  // before the engine runs.
  rows.sort((a, b) => b.score - a.score);
  // THE RANKING BASIS, FOR THE EVENTS THAT ACTUALLY EARNED A ROW.
  const rarity: Record<string, number> = {};
  for (const row of rows) rarity[row.event] = freq[row.event] ?? 1;
  return { rows, pool, rarity };
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
function pickReason<T extends { text: string; repeatability?: string; impliedProducer?: boolean }>(
  reasons: T[],
): T {
  // AN AUTHORED SUPPLY OUTRANKS THE BASELINE ONE, and it outranks repeatability too. Krenko is a
  // Goblin AND he taps to make Goblins, so he satisfies `enters:goblin` twice; both sentences carry
  // the consumer's own repeatability, so that rule cannot separate them and the body's -- "When
  // Krenko, Mob Boss enters" -- won on emission order. `impliedProducer` marks the baseline the
  // matcher synthesises for a card merely existing; the authored emit is the engine the reader came
  // to the page for. MEASURED 2026-09-04: 6,407 rows on 1,714 cards printed the body's sentence.
  const rank = (r: { repeatability?: string; impliedProducer?: boolean }) =>
    (r.impliedProducer === true ? 2 : 0) + (r.repeatability && r.repeatability !== "oneshot" ? 0 : 1);
  // RETURNS THE REASON, NOT ITS TEXT. The row needs to say whether the engine read the effect behind
  // the sentence it printed, and that is a property of the CHOSEN reason -- asking whether every
  // candidate lacked a kind marked 27 rows where roughly fifteen thousand qualified.
  return reasons.reduce((best, r) => (rank(r) < rank(best) ? r : best));
}


/** Re-exported so every existing importer keeps working; the definition moved to its own file
 *  because the Pages Function needs the shard rule without `edges.ts` behind it. */
export { PARTNER_SHARD_COUNT, partnerShardOf };

/** THE DERIVED ABILITIES AS PAGE ROWS. Order is the derivation's own, which is the order the clauses
 *  appear on the card -- so the table reads down the card the way a player does. */
export const abilityRowsOf = (d: DeckCard): AbilityRow[] =>
  abilitiesOf(d).map((a) => {
    const counted = a.effect?.scalingSubject;
    // EVERYTHING IT COUNTS. A party count names four types; the first alone read "counts Clerics".
    const subtype = Array.isArray(counted?.subtype) ? counted?.subtype.join(", ") : counted?.subtype;
    return {
      kind: a.kind,
      ...(a.cost ? { cost: a.cost } : {}),
      when: (a.trigger?.verbs ?? []).map((v) =>
        eventKey({ verb: v, subject: a.trigger!.subject } as GameEvent)),
      // THE TRIGGER IS THE CARD ITSELF: the key cannot carry it, so the row says it beside the key.
      ...(a.trigger?.subject?.self === true ? { self: true as const } : {}),
      // A GAME-STATE REQUIREMENT the deck report honours only under a state (roadmap W18).
      ...(a.requires ? { requires: a.requires } : {}),
      effect: a.effect?.kind ?? "",
      ...(a.amount ? { amount: a.amount } : {}),
      ...(a.effect?.subject?.control && a.effect.subject.control !== "you" ? { recipient: a.effect.subject.control } : {}),
      ...(a.effect?.scaling ? { scaling: a.effect.scaling } : {}),
      ...(subtype ? { counts: subtype } : {}),
      emits: (a.emits ?? []).map(eventKey),
    };
  });

/** EVERY ABILITY THE ENGINE READS ON THE CARD: the derived ones and the ones its printed keywords
 *  give it (`keywordAbilities` -- prowess, extort, Start your engines!). Edge formation has always
 *  merged the two; the page read the stored list alone, so Samut, the Driving Force showed two
 *  statics and no reason for a drain card to be near her (roadmap W9, 2026-09-05). */
export const abilitiesOf = (d: DeckCard): CardTags["abilities"] =>
  d.tags ? [...d.tags.abilities, ...keywordAbilities(d.tags.characteristics)] : [];

export const emitKeysOf = (d: DeckCard): string[] =>
  abilitiesOf(d).flatMap((a) => (a.emits ?? []).map(eventKey));

export const demandKeysOf = (d: DeckCard): string[] => [
  // A CARD'S OWN TRIGGER IS NOT A DEMAND ON THE OTHER 99. Burakos, Party Leader fires when HE
  // attacks (`self: true`, derived correctly); keyed as `attacks|-|-|-` the page filed it as a gap
  // the deck must cover and ranked attackers as his partners (owner, 2026-09-05). The deck report
  // already gates self triggers; the page now does the same.
  ...abilitiesOf(d).flatMap((a) =>
    a.trigger?.subject?.self === true ? []
      : (a.trigger?.verbs ?? []).map((v) => eventKey({ verb: v, subject: a.trigger!.subject } as GameEvent))),
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
export const boardCountKeysOf = (d: DeckCard): string[] => [...new Set(boardCountsOf(d).map((b) => b.key))];

/** EVERY SUBTYPE A BOARD COUNT NAMES IS ITS OWN KEY, each carrying the tag the engine writes for
 *  the ability. A party count (CR 700.7) names Cleric, Rogue, Warrior and Wizard; keyed on the
 *  first alone, Burakos's page asked only for Clerics (owner, 2026-09-05). The engine's tag takes
 *  the first subtype (`themeSubjectKey`), so a Rogue feeder is verified under `scales:cleric` --
 *  the tag is carried beside the key rather than rebuilt from it. */
export const boardCountsOf = (d: DeckCard): { key: string; tag: string }[] =>
  abilitiesOf(d).flatMap((a) => {
    const counted = a.effect?.scalingSubject;
    if (!counted || counted.zone !== "battlefield" || counted.control === "opp") return [];
    const subtypes = (Array.isArray(counted.subtype) ? counted.subtype : counted.subtype === undefined ? [] : [counted.subtype])
      .filter((st) => !BASIC_LAND_TYPES.has(st));
    const tag = `scales:${themeSubjectKey(counted)}`;
    return subtypes.map((st) => ({ key: `counts|-|${st}|-`, tag }));
  });

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
  emitKeysOf(d).length > 0 || demandKeysOf(d).length > 0 || staticKeysOf(d).length > 0
  || meldKeysOf(d).length > 0
  // EVERY LEGAL COMMANDER, ABILITIES OR NOT. Clara Oswald derives one trigger-doubler with no
  // subject, so no key above ever admitted her and a Doctor's page offered a companion with
  // nowhere to link (real build, 2026-09-05). A commander the engine read NOTHING on needs a page
  // more than most: an empty ability table is where a wrong "no ability" can be seen at all
  // (roadmap W10) -- 117 derived commanders carried zero abilities and 373 were never bought.
  || isCommander(d);

/** MELD, as a demand key. `meld|-|-|-` when the card names its other half; the candidate is that
 *  one card, found by name, and the row is verified on the engine's own `meld` tag. A card-NAME
 *  relation: it emits nothing and counts nothing, so neither ranking phase could ever propose it,
 *  and the deck report drew the edge while the page never asked (2026-09-05). */
export const meldKeysOf = (d: DeckCard): string[] =>
  (d.card as { meldPartner?: string }).meldPartner ? ["meld|-|-|-"] : [];

const WUBRG = ["W", "U", "B", "R", "G"] as const;
/** WUBRG order, deduped; "C" for colourless. The client's `identityKey` sorts the same way; both
 *  sides must agree because this string is the lookup key on the page. */
export function identityKeyOf(colors: readonly string[]): string {
  const set = new Set(colors);
  return WUBRG.filter((c) => set.has(c)).join("") || "C";
}

/** WHAT A STATIC REACHES, as a demand key: `applies:<kind>|<types>|<subtypes>|-`.
 *
 *  A STATIC IS THE THIRD KIND OF RELATION THIS FILE KNOWS. The forward phase ranks on what a card
 *  EMITS, the feeder phase on what it COUNTS; a static emits nothing and counts nothing, it
 *  APPLIES to a class of cards. Samut, the Driving Force prints an anthem and a discount and
 *  nothing else, so on 2026-09-05 she had no page and no `/commanders` row while the deck report
 *  drew eleven edges from her. MEASURED that day: 970 corpus cards carry a static this key can
 *  name, 71 of them commanders the index was refusing.
 *
 *  THE SAME REFUSALS `edges.ts`'s static pass makes, so a key never proposes a pair the engine
 *  will not verify: a role (`ROLE_NOT_SYNERGY`: tax and friends), a debuff (a negative modifier
 *  improves nothing), a self-reference (the largest defect family this engine has had). A pseudo-
 *  type is spelled out to its members here so the candidate index below is keyed on printed types
 *  only. CEILING: a subject with neither type nor subtype ("permanents you control") makes no key
 *  -- measured at 0 of 1,117 static subjects, so the branch is not worth its line yet. */
const kindNotARelation = (kind: string): boolean => ROLE_NOT_SYNERGY.has(kind) || kind === "debuff" || kind === "ability-loss";
const asList = (v: string | string[] | undefined): string[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const concreteTypes = (types: string[]): string[] => [...new Set(types.flatMap((raw) => {
  const t = raw.toLowerCase();
  return (ALL_CARD_TYPES as readonly string[]).includes(t) ? [t] : PSEUDO_TYPE_SETS[t] ?? [];
}))];
export const staticKeysOf = (d: DeckCard): string[] => [...new Set(
  abilitiesOf(d).flatMap((a) => {
    const s = a.effect?.subject;
    if (a.kind !== "static" || !s || s.self === true || kindNotARelation(a.effect.kind)) return [];
    const types = concreteTypes(asList(s.type));
    const subtypes = asList(s.subtype).map((x) => x.toLowerCase());
    if (types.length === 0 && subtypes.length === 0) return [];
    return [`applies:${a.effect.kind}|${types.join(",") || "-"}|${subtypes.join(",") || "-"}|-`];
  }),
)];

/** WHAT A CARD IS FOR A STATIC'S PURPOSES: its printed types and subtypes, AND those of the tokens
 *  it makes. A noncreature spell that makes creature bodies is what a Samut deck is built from --
 *  the discount and the anthem both land on it -- and the ranking has to see that before the
 *  engine is asked, because the engine is asked about at most `VERIFY_LIMIT` candidates. The anthem
 *  ROW is still never claimed on the maker: no token node exists on a page to carry it. */
const reachOf = (c: DeckCard): { types: Set<string>; subtypes: Set<string> } => {
  const types = new Set(c.tags?.characteristics.types.map((t) => t.toLowerCase()) ?? []);
  const subtypes = new Set(c.tags?.characteristics.subtypes.map((t) => t.toLowerCase()) ?? []);
  for (const a of abilitiesOf(c)) {
    for (const e of a.emits ?? []) {
      if (e.subject.token !== true) continue;
      for (const t of asList(e.subject.type)) types.add(t.toLowerCase());
      for (const t of asList(e.subject.subtype)) subtypes.add(t.toLowerCase());
    }
  }
  return { types, subtypes };
};
const splitStaticKey = (key: string): { kind: string; types: string[]; subtypes: string[] } => {
  const [verb = "", type = "-", subtype = "-"] = key.split("|");
  const dash = (v: string) => v === "-" ? [] : v.split(",");
  return { kind: verb.slice("applies:".length), types: dash(type), subtypes: dash(subtype) };
};
export const staticReaches = (key: string, c: DeckCard): boolean => {
  const { types, subtypes } = splitStaticKey(key);
  const reach = reachOf(c);
  return (types.length === 0 || types.some((t) => reach.types.has(t)))
    && (subtypes.length === 0 || subtypes.some((t) => reach.subtypes.has(t)));
};

/** NO CARD RULES TEXT (spec D2, reversed 2026-09-04). Name, type line and mana cost are card
 *  METADATA and the page is unusable without them; the RULES text is absent entirely.
 *
 *  The evidence a reader checks a claim against is `PartnerRow.reason` -- the engine's own sentence,
 *  naming both cards -- not the card's printed text. Quoting the card would add nothing to that
 *  argument and would only make the page resemble a card database, which is what Scryfall's
 *  "may not simply repackage, republish, or proxy" clause is about. */
/** ONE DERIVED ABILITY, PROJECTED DOWN TO WHAT A PAGE CAN SHOW.
 *
 *  "HOW THE ENGINE READS THIS CARD" IS THE PAGE'S REAL ARGUMENT, and until now the pages printed
 *  only the union of a card's events -- two flat lines standing in for three abilities. A reader
 *  checking a claim needs to see WHICH ability produced it: the tap ability that makes the tokens is
 *  a different fact from the body that happens to be a Goblin.
 *
 *  THIS IS OUR DERIVATION AND NOT WIZARDS' TEXT, which is the whole reason it may be published where
 *  the oracle text may not (spec D2, reversed). The card's own words are on the card image beside it.
 *
 *  PROJECTED, NOT COPIED. A derived ability carries clause ids, subject filters, recipients and
 *  scaling internals; a page can show none of that without becoming a debugger. Each field here
 *  earns its bytes across 15,384 records. */
export interface AbilityRow {
  /** `triggered`, `activated`, `static`, `on-cast` -- what makes this ability happen at all. */
  kind: string;
  /** The activation cost, where there is one: `{T}`, `{2}, {T}`. */
  cost?: string;
  /** The events that set it off, as event keys, so the page renders them with the same sentence
   *  function every other event on the site uses. */
  when: string[];
  /** The trigger is the card itself ("whenever this creature attacks"); the page reads `when` as
   *  "this card …" rather than "anything …". */
  self?: true;
  /** "Max speed —": the player's speed this ability needs (CR 702.179), shown on the row. */
  requires?: { marker: string; min: number };
  /** The effect's kind (`token-generation`, `draw-card`). Humanised at the edge, never here. */
  effect: string;
  amount?: string;
  /** Who a draw or a life change goes to, when it is not the card's controller (`opp`, `any`). */
  recipient?: string;
  /** The basis a magnitude counts on (`per-permanent`), and what it counts, where both are known. */
  scaling?: string;
  counts?: string;
  /** The events it puts into the game. */
  emits: string[];
}

export interface CardPageRecord {
  name: string;
  typeLine: string;
  manaCost: string | null;
  /** THE CARD'S OWN PICTURE, as Scryfall's `art_crop` URL -- the client rewrites the path segment
   *  to `/normal/` for the whole card, which is what `cardImageUrl` already does for the graph.
   *
   *  THE FULL CARD, NEVER THE CROP, and that is a licence line rather than a taste one: an art crop
   *  has to credit the artist and this corpus HAS NO ARTIST FIELD (measured 2026-09-04: 0 of 34,433
   *  cards). The whole card prints the credit itself, bottom-left, which is the branch spec D2a
   *  offers and the only one available here.
   *
   *  Present on 33,942 of 34,433 corpus cards; `null` where Scryfall has no image, and the pages
   *  render without one rather than reserving a hole for it. */
  artCrop: string | null;
  /** How the engine read the card, one row per derived ability -- the page's real argument, and the
   *  half of it that was missing while the record carried only the UNION of a card's events. */
  abilities: AbilityRow[];
  identity: string[];
  commander: boolean;
  /** A Background: a commander that never leads alone (CR 702.124). The page says so. */
  pairingOnly?: true;
  /** THE CARDS THIS COMMANDER MAY LEAD WITH (CR 702.124), from `pairingLicense` -- the same
   *  function the legality report uses, so the page can never offer a pair the report would flag.
   *  Only substantive cards, because a row must link to a page. Commander records only. */
  pairsWith?: { slug: string; name: string; identity: string[]; licence: string; choosesColour?: true }[];
  /** CR 903.4b: choose its colour before the game; the page offers five. */
  choosesColour?: true;
  /** THE SAME LIST, RE-RANKED PER IDENTITY A PAIRING CAN REACH, keyed by `identityKeyOf`. A picked
   *  partner widens the deck's identity, and the list is ranked over the legal pool, so it has to be
   *  ranked again per identity the pair can reach. Keyed by colour set and not by partner card,
   *  because the legal pool depends on identity alone: two mono-black Backgrounds give one list.
   *  Absent for the own identity (that is `commanderPartners`). A colour chooser gets one per colour,
   *  and one per colour-plus-partner when it pairs as well (Clara Oswald beside a Doctor). */
  commanderPartnersBy?: Record<string, { partners: PartnerRow[]; pool: Record<string, number>; rarity: Record<string, number> }>;
  emits: string[];
  demands: string[];
  partners: PartnerRow[];
  /** Per event key, how many cards demand something this card supplies -- what the page says in
   *  place of the rows `PER_EVENT_CAP` withheld. */
  pool: Record<string, number>;
  /** Per event key, how many cards in the corpus can CAUSE it -- the number the ranking is computed
   *  from, and a DIFFERENT population from `pool`. Shipped because the page was showing one and
   *  ranking on the other, and a reader who reconstructed the order from the visible figure
   *  correctly concluded it was broken. */
  rarity: Record<string, number>;
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
  commanderRarity?: Record<string, number>;
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

/** A COMMANDER, for `/commanders`: CR 903.3 exactly as `legality.ts` reads it -- legendary creature,
 *  Vehicle or Spacecraft with printed power, a card that says it can be your commander, a
 *  Background -- and commander-legal. This file used to say "Legendary Creature" and call the rest a
 *  larger question; the answer was already three files away, and the gap was 40 Vehicles, 5
 *  Spacecraft and 21 planeswalkers (measured 2026-09-05). */
const isCommander = (d: DeckCard): boolean =>
  isLegalCommander(d.card as Card)
  && (d.card as { legalities?: Record<string, string> }).legalities?.commander === "legal";

/** A Background is a commander only opposite a card that prints "Choose a Background" -- the same
 *  test `pairingLicense` makes, so the record and the licence can never disagree. */
const isBackground = (d: DeckCard): boolean => isBackgroundCard(d.card as Card);

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

  // THE INDEX A STATIC ASKS: cards by what they ARE, printed types and the types of their tokens.
  // Only ever read through `staticKeysOf`, so a card with no static pays nothing for it. The
  // frequency a static key is priced on is the size of the class it reaches -- a discount on every
  // noncreature spell is as common a relation as there are noncreature spells, which is what puts
  // it below a rare trigger on the page, exactly as the deck report's own mesh census treats it.
  const byType = new Map<string, DeckCard[]>();
  for (const d of substantive) {
    for (const t of reachOf(d).types) {
      const b = byType.get(t);
      if (b) b.push(d); else byType.set(t, [d]);
    }
  }
  const staticCandidates = (d: DeckCard): DeckCard[] => [...new Set(staticKeysOf(d).flatMap((k) => {
    const { types, subtypes } = splitStaticKey(k);
    const pool = types.length > 0
      ? types.flatMap((t) => byType.get(t) ?? [])
      : subtypes.flatMap((st) => bySubtype.get(`counts|-|${st}|-`) ?? []);
    return pool.filter((c) => staticReaches(k, c));
  }))];
  for (const d of substantive) {
    for (const k of staticKeysOf(d)) if (freq[k] === undefined) freq[k] = staticCandidates(d).filter((c) => staticReaches(k, c)).length;
  }

  // THE ONE CANDIDATE A NAME FINDS. A meld card names its other half; nothing else here is keyed
  // on a card name, and one card can cause the relation, so the key is priced as a rarity of one.
  const byName = new Map(substantive.map((d) => [d.card.name, d] as const));
  freq["meld|-|-|-"] = 1;

  // EVERY COMMANDER, ONCE, for the pairing scan below. CEILING: `pairsWith` is O(commanders^2)
  // regex pairs -- a full scan per commander, 3,444 x 3,443 = 11.9 M cheap tests on the 2026-09-05
  // corpus, inside a build that went 66 s -> 80 s. The upgrade path is to bucket by licence form
  // first (bare Partner, label, Background, Doctor) so each card is compared only with its own form.
  const commanders = substantive.filter(isCommander);

  const shards = new Map<string, Record<string, CardPageRecord>>();
  const index: NameIndexEntry[] = [];

  for (const d of substantive) {
    const slug = slugs.get(d.card.name)!;
    const emits = emitKeysOf(d);
    // CANDIDATES COME FROM WHAT THE CARD SUPPLIES, WHICH INCLUDES WHAT IT IS. `emits` is what the
    // record PRINTS; `supplyKeysOf` is what the ranking may ask about, and the difference is the
    // card's own subtypes -- a Goblin body is a candidate for every payoff that counts Goblins.
    const candidates = [...new Set([
      ...supplyKeysOf(d).flatMap(supplyForms).flatMap((k) => byDemand.get(k) ?? []),
      ...staticCandidates(d),
    ])];
    const feeders = [...new Set(boardCountKeysOf(d).flatMap((k) => bySubtype.get(k) ?? []))];
    const commander = isCommander(d);
    const meldWith = byName.get((d.card as { meldPartner?: string }).meldPartner ?? "");

    const shardName = partnerShardOf(slug);
    const shard = shards.get(shardName) ?? {};
    shard[slug] = {
      name: d.card.name,
      typeLine: d.card.typeLine ?? "",
      manaCost: (d.card as { manaCost?: string }).manaCost ?? null,
      artCrop: (d.card as { artCrop?: string }).artCrop ?? null,
      abilities: abilityRowsOf(d),
      identity: d.card.colorIdentity ?? [],
      commander,
      ...(commander && isBackground(d) ? { pairingOnly: true as const } : {}),
      emits: [...new Set(emits)],
      demands: [...new Set([...demandKeysOf(d), ...staticKeysOf(d), ...meldKeysOf(d)])],
      ...(() => { const { rows, pool, rarity } = partnersFor(d, candidates, feeders, freq, slugs, h, meldWith);
        return { partners: rows, pool, rarity }; })(),
      // A CARD IS LEGAL IN A DECK WHEN ITS WHOLE IDENTITY SITS INSIDE THE COMMANDER'S -- the same
      // rule `legality.ts` reports a violation against. An empty identity is inside every one,
      // which is why a colourless card belongs in every deck and `every` over `[]` says so.
      ...(commander ? (() => {
        const pairsWith = commanders
          .filter((o) => o.card.name !== d.card.name)
          .map((o) => ({ o, licence: pairingLicense(d.card as Card, o.card as Card) }))
          .filter((x): x is { o: DeckCard; licence: string } => x.licence !== undefined)
          .map(({ o, licence }) => ({
            slug: slugs.get(o.card.name)!, name: o.card.name,
            identity: o.card.colorIdentity ?? [], licence,
            // THE PARTNER MAY BE THE ONE WHO CHOOSES: Clara beside a Doctor makes the pair three
            // colours, and the Doctor's page has to offer her colour.
            ...(choosesColour(o.card as Card) ? { choosesColour: true as const } : {}),
          }))
          .sort((a, b) => a.licence.localeCompare(b.licence) || a.name.localeCompare(b.name));
        const rankedFor = (identity: Set<string>) => {
          const legal = candidates.filter((c) => (c.card.colorIdentity ?? []).every((x) => identity.has(x)));
          const legalFeeders = feeders.filter((c) => (c.card.colorIdentity ?? []).every((x) => identity.has(x)));
          // The other half is in the same deck by construction, so it needs no identity check.
          const { rows, pool, rarity } = partnersFor(d, legal, legalFeeders, freq, slugs, h, meldWith);
          return { partners: rows, pool, rarity };
        };
        const own = d.card.colorIdentity ?? [];
        const { partners, pool, rarity } = rankedFor(new Set(own));
        // EVERY IDENTITY A PAIRING CAN REACH, minus the own one. Sizing measured 2026-09-05: bare
        // Partner 495 variant lists over 55 cards, Backgrounds 129 over 32, Doctors 76 over 24,
        // labels 56 over 18 -- about 900 extra rankings on a 66 s build.
        const reach = new Set<string>();
        const self = choosesColour(d.card as Card);
        if (self) for (const c of WUBRG) reach.add(identityKeyOf([...own, c]));
        for (const p of pairsWith) {
          // Either half may choose; the colour joins the pair's identity from whichever side.
          if (self || p.choosesColour) for (const c of WUBRG) reach.add(identityKeyOf([...own, c, ...p.identity]));
          else reach.add(identityKeyOf([...own, ...p.identity]));
        }
        reach.delete(identityKeyOf(own));
        const commanderPartnersBy = Object.fromEntries(
          [...reach].map((key) => [key, rankedFor(new Set(key === "C" ? [] : key.split("")))]),
        );
        return {
          commanderPartners: partners, commanderPool: pool, commanderRarity: rarity,
          ...(pairsWith.length > 0 ? { pairsWith } : {}),
          ...(choosesColour(d.card as Card) ? { choosesColour: true as const } : {}),
          ...(reach.size > 0 ? { commanderPartnersBy } : {}),
        };
      })() : {}),
    };
    shards.set(shardName, shard);
    index.push({ slug, name: d.card.name, identity: d.card.colorIdentity ?? [], commander });
  }

  return { shards, freq, index };
}
