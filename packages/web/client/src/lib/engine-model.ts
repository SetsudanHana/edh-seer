import type { CardGraph, DeckReport } from "../types.js";

/** THE DECK AS THE FEW THINGS IT DOES, NOT AS 800 LINES (graph evaluation 2026-09-25).
 *
 *  Measured on nine decks: 340–830 links each, 81–98% of them weight 1, and 5–11 mechanisms carry
 *  80% of the links. Inside a mechanism the links are near-complete two-sided blocks -- fifty
 *  Clerics each linked to the five cards that count Clerics, 246 lines saying one thing. This
 *  module groups the links back into those blocks ("engines"), keeps the repeatability the board
 *  never showed, and derives the three answers four persona rounds asked for: the pairs that work
 *  best together, the cards doing the least, and the removal and ramp judged by their job.
 *
 *  Built from `report.edges` rather than `graph.edges`: the report keeps each reason's tag,
 *  sentence, repeatability and direction together, where the wire graph keeps the sentences but
 *  drops repeatability. Pure, so the view is a rendering of this and nothing else. */

export type Repeat = "static" | "triggered" | "activated" | "oneshot";

/** One reason, directed: `from` supplies it, `to` benefits. Ids are graph node ids. */
export interface Link { from: string; to: string; tag: string; text: string; repeat: Repeat }

/** Every reason between two cards, in both directions. `a < b`. */
export interface Pair { a: string; b: string; links: Link[]; once: boolean }

export interface EngineCard {
  id: string; name: string; typeLine: string; text: string; art?: string;
  isToken: boolean; isCommander: boolean; isLand: boolean; isFace: boolean;
  roles: readonly string[]; score: number;
}

export interface EngineGroup {
  tag: string; name: string;
  /** A one-to-many helper (cost reducer, recursion, tutor, land fetch, type grant) rather than
   *  something the deck is doing. Listed apart, below the deck's own groups. */
  helper: boolean;
  /** The small side: the cards that do something extra when the big side is involved -- or, for a
   *  helper, the helper itself. */
  hubs: string[];
  members: string[];
  /** Whether the hubs are the consumers (the usual shape: many feed a few). */
  hubsConsume: boolean;
  repeating: number; once: number;
  /** Members whose every link in this group works only once. */
  onceOnly: ReadonlySet<string>;
  example?: Link;
  hue: string;
}

export interface CutRow {
  card: EngineCard;
  /** Other cards it keeps working with, counting every repeating link that is not a helper's. */
  real: number;
  /** Cards it helps in the background: made cheaper, given types, found or brought back. */
  gives: number;
  once: number; partners: number;
  why: string;
  keep?: Link;
  jobs: string[];
}

export interface StrongPair { pair: Pair; ways: string[]; both: boolean; lines: Link[] }

export interface EngineModel {
  cards: ReadonlyMap<string, EngineCard>;
  partners: ReadonlyMap<string, ReadonlyMap<string, Pair>>;
  groups: EngineGroup[];
  /** Deck groups first, then helpers. */
  membership: ReadonlyMap<string, EngineGroup[]>;
  totalLinks: number; coveredLinks: number; onceLinks: number; onceInGroups: number;
  deckCards: number; tokens: number;
  strongest: StrongPair[];
  cuts: CutRow[];
  jobs: [string, CutRow[]][];
}

/** The projection's node identity, copied rather than imported: `@edh-seer/matcher/graph-projection`
 *  pulls the whole engine into the bundle for three lines. `engine-model.test.ts` holds the two
 *  equal. */
export function nodeId(name: string, isToken?: boolean, face?: number, isEmblem?: boolean): string {
  if (isEmblem) return `emblem:${name}`;
  if (isToken) return `token:${name}`;
  return face ? `face:${face}:${name}` : name;
}

/** The categorical order the board already validated for colour-vision separation (`ROLE_HUE`,
 *  presets.ts), six deck groups at most. Helpers are drawn neutral. */
const GROUP_HUES = ["#1c8db7", "#b08e1d", "#5b40f6", "#21a28f", "#277310", "#6b89f9"];
const HELPER_HUE = "#6b5f7d";
const MAX_DECK_GROUPS = 6;
const MAX_HELPER_GROUPS = 4;
/** A mechanism smaller than this is a pair or two, not something the deck does. */
const MIN_GROUP_LINKS = 6;

const HELPER_TAG = /^(static:cost-reduction|static:type-grant|recursion-target|tutor|ramp-target)/;
export const isHelperTag = (tag: string): boolean => HELPER_TAG.test(tag);

const CARD_TYPES = new Set(["creature", "land", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "permanent", "spell", "battle"]);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A subject as the plural a player says: "creatures", "Clerics", "noncreature spells". */
export function plural(subject: string): string {
  if (!subject || subject === "any") return "cards";
  if (subject.startsWith("-")) return `non${subject.slice(1)} ${subject === "-land" ? "cards" : "spells"}`;
  const w = CARD_TYPES.has(subject) ? subject : capital(subject);
  if (w === "sorcery") return "sorceries";
  if (/(ch|sh|s|x)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/f$/i.test(w)) return `${w.slice(0, -1)}ves`;
  return `${w}s`;
}

/** A group's name in a player's words. Taken from what the tag's sentences say, not from the tag's
 *  spelling: `scales:cleric` is "counts it and does more", which is counting Clerics, whatever the
 *  inspector's label says about graveyards. */
export function groupName(tag: string): string {
  const exact: Record<string, string> = {
    "static:pump": "Lords: bigger stats", "static:keyword-grant": "Grants abilities", "static:type-grant": "Grants creature types",
    "static:cost-reduction": "Make cards cheaper", "static:speed-increase": "Grants haste",
  };
  if (exact[tag]) return exact[tag];
  const i = tag.indexOf(":");
  const kind = i < 0 ? tag : tag.slice(0, i);
  const sub = i < 0 ? "" : tag.slice(i + 1);
  const p = plural(sub), P = capital(p);
  switch (kind) {
    case "scales": return `Counts your ${p}`;
    case "enters": return `${P} entering`;
    case "cast": return `Casting ${p}`;
    case "dies": return `${P} dying`;
    case "attacks": return `${P} attacking`;
    case "combat-damage": return `${P} dealing combat damage`;
    case "non-combat-damage": return "Dealing damage";
    case "counter-added": return `Counters on ${p}`;
    case "graveyard-recursion": return `${P} coming back`;
    case "recursion-target": return `Bringing back ${p}`;
    case "ramp-target": return `Fetching ${P}`;
    case "tutor": return `Searching for ${p}`;
    case "fodder": return `${P} to sacrifice`;
    case "copies": return sub && sub !== "any" ? `Copying ${sub} abilities` : "Copying abilities";
    case "doubles": return `Doubling ${sub && sub !== "any" ? `${capital(sub)} ` : ""}triggers`;
    case "creates": return "Making tokens";
    case "lose-life": return "Losing life";
    case "threshold": return "A full graveyard";
    default: return capital(tag.replace(/[:-]/g, " "));
  }
}

/** The jobs a link count cannot judge, in words the precon seat knew (round 4 flagged "ramp",
 *  "counterspell" and "board wipe"). Keyed on the engine's role ids. */
export const JOB_WORDS: Record<string, string> = {
  ramp: "Extra mana", targetedRemoval: "Removal", boardWipe: "Clears the board", stackInteraction: "Counters spells",
  protection: "Protects your cards", burn: "Deals damage", graveyardHate: "Empties graveyards", stax: "Slows opponents",
};

const REPEAT_ORDER: Record<Repeat, number> = { static: 0, triggered: 1, activated: 2, oneshot: 3 };
const asRepeat = (r: string | undefined): Repeat => (r === "static" || r === "activated" || r === "oneshot" ? r : "triggered");
const pairKey = (x: string, y: string) => (x < y ? `${x}\u0001${y}` : `${y}\u0001${x}`);

export function buildEngineModel(report: DeckReport, graph: CardGraph): EngineModel {
  const scoreByName = new Map(report.cards.map((c) => [c.name, c.score ?? 0]));
  const commanders = new Set(report.commanders);
  const cards = new Map<string, EngineCard>();
  for (const n of graph.nodes) {
    cards.set(n.id, {
      id: n.id, name: n.label, typeLine: n.typeLine ?? "", text: n.oracleText ?? "", art: n.artCrop,
      isToken: n.isToken === true, isCommander: commanders.has(n.cardName ?? n.id),
      isLand: (n.types ?? []).includes("land"), isFace: n.cardName !== undefined && n.cardName !== n.id,
      roles: n.roles ?? [], score: scoreByName.get(n.label) ?? 0,
    });
  }

  // Links, deduplicated on direction + tag + sentence: a trigger with a chain of effects repeats one
  // sentence per effect kind, and the reader counts sentences.
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (!r.producer || !r.consumer) continue;
      const from = nodeId(r.producer, r.producerIsToken, r.producerFace, r.producerIsEmblem);
      const to = nodeId(r.consumer, r.consumerIsToken, r.consumerFace, r.consumerIsEmblem);
      if (!cards.has(from) || !cards.has(to) || from === to) continue;
      const k = `${from}\u0001${to}\u0001${r.tag}\u0001${r.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      links.push({ from, to, tag: r.tag, text: r.text, repeat: asRepeat(r.repeatability) });
    }
  }

  const pairs = new Map<string, Pair>();
  const partners = new Map<string, Map<string, Pair>>();
  for (const l of links) {
    const k = pairKey(l.from, l.to);
    let p = pairs.get(k);
    if (!p) {
      p = { a: l.from < l.to ? l.from : l.to, b: l.from < l.to ? l.to : l.from, links: [], once: true };
      pairs.set(k, p);
      for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
        if (!partners.has(x)) partners.set(x, new Map());
        partners.get(x)!.set(y, p);
      }
    }
    p.links.push(l);
    if (l.repeat !== "oneshot") p.once = false;
  }

  // GROUPS: one per tag, ranked by links that repeat.
  const byTag = new Map<string, Link[]>();
  for (const l of links) { if (!byTag.has(l.tag)) byTag.set(l.tag, []); byTag.get(l.tag)!.push(l); }
  const ranked = [...byTag.entries()]
    .filter(([, ls]) => ls.length >= MIN_GROUP_LINKS)
    .map(([tag, ls]) => ({ tag, ls, rep: ls.filter((l) => l.repeat !== "oneshot").length }))
    .sort((x, y) => y.rep - x.rep || y.ls.length - x.ls.length || (x.tag < y.tag ? -1 : 1));
  const groups: EngineGroup[] = [];
  let deckN = 0, helperN = 0;
  for (const { tag, ls, rep } of ranked) {
    const helper = isHelperTag(tag);
    if (helper ? helperN >= MAX_HELPER_GROUPS : deckN >= MAX_DECK_GROUPS) continue;
    const producers = new Set(ls.map((l) => l.from)), consumers = new Set(ls.map((l) => l.to));
    const hubsConsume = consumers.size <= producers.size;
    const repeatingCards = new Set(ls.filter((l) => l.repeat !== "oneshot").flatMap((l) => [l.from, l.to]));
    const members = [...(hubsConsume ? producers : consumers)];
    groups.push({
      tag, name: groupName(tag), helper,
      hubs: [...(hubsConsume ? consumers : producers)], members, hubsConsume,
      repeating: rep, once: ls.length - rep,
      onceOnly: new Set(members.filter((m) => !repeatingCards.has(m))),
      example: helper ? undefined : (ls.find((l) => l.repeat !== "oneshot") ?? ls[0]),
      hue: helper ? HELPER_HUE : GROUP_HUES[deckN] ?? HELPER_HUE,
    });
    if (helper) helperN++; else deckN++;
  }
  groups.sort((x, y) => Number(x.helper) - Number(y.helper));
  const groupByTag = new Map(groups.map((g) => [g.tag, g]));

  const membership = new Map<string, EngineGroup[]>();
  for (const g of groups) for (const id of [...g.hubs, ...g.members]) {
    if (!membership.has(id)) membership.set(id, []);
    if (!membership.get(id)!.includes(g)) membership.get(id)!.push(g);
  }

  const covered = links.filter((l) => groupByTag.has(l.tag));
  const onceLinks = links.filter((l) => l.repeat === "oneshot").length;
  const deckCards = [...cards.values()].filter((c) => !c.isToken && !c.isFace && !c.id.startsWith("emblem:"));

  return {
    cards, partners, groups, membership,
    totalLinks: links.length, coveredLinks: covered.length, onceLinks,
    onceInGroups: covered.filter((l) => l.repeat === "oneshot").length,
    deckCards: deckCards.length, tokens: [...cards.values()].filter((c) => c.isToken).length,
    strongest: strongestPairs(pairs, cards, groupByTag),
    ...cutList(deckCards, partners, groupByTag),
  };
}

/** THE PAIRS THAT WORK BEST TOGETHER. Ranked by how many different things they do for each other
 *  (the names shown, so the count and the list agree -- round 3), whether it goes both ways, whether
 *  one of them is the commander, and how central both cards are. No card appears more than twice:
 *  without the cap one card filled the whole strip on Party Time. */
function strongestPairs(pairs: Map<string, Pair>, cards: Map<string, EngineCard>, groups: Map<string, EngineGroup>): StrongPair[] {
  const smax = Math.max(1, ...[...cards.values()].map((c) => c.score));
  const rows = [...pairs.values()].flatMap((pair) => {
    const a = cards.get(pair.a)!, b = cards.get(pair.b)!;
    if (a.isToken || b.isToken) return [];
    const rep = pair.links.filter((l) => l.repeat !== "oneshot" && !isHelperTag(l.tag));
    if (!rep.length) return [];
    const ways = [...new Set(rep.map((l) => groups.get(l.tag)?.name ?? groupName(l.tag)))];
    const both = new Set(rep.map((l) => l.from)).size > 1;
    const strength = ways.length + (both ? 1.5 : 0) + (a.isCommander || b.isCommander ? 1 : 0) + (3 * (a.score + b.score)) / (2 * smax);
    // Both directions on screen when it goes both ways, so "each helps the other" is visible.
    const ordered = [...rep].sort((x, y) => REPEAT_ORDER[x.repeat] - REPEAT_ORDER[y.repeat]);
    const first = ordered[0]!;
    const back = ordered.find((l) => l.from !== first.from);
    const lines = [first, ...(back ? [back] : []), ...ordered.filter((l) => l !== first && l !== back)].slice(0, 3);
    return [{ pair, ways, both, lines, strength }];
  }).sort((x, y) => y.strength - x.strength || (x.pair.a < y.pair.a ? -1 : 1));
  const out: StrongPair[] = [];
  const used = new Map<string, number>();
  for (const r of rows) {
    if ((used.get(r.pair.a) ?? 0) >= 2 || (used.get(r.pair.b) ?? 0) >= 2) continue;
    out.push({ pair: r.pair, ways: r.ways, both: r.both, lines: r.lines });
    for (const id of [r.pair.a, r.pair.b]) used.set(id, (used.get(id) ?? 0) + 1);
    if (out.length === 4) break;
  }
  return out;
}

const s = (n: number) => (n === 1 ? "" : "s");

/** THE CARDS DOING THE LEAST, and removal and ramp judged by their job.
 *
 *  Every repeating link counts, trigger doublers included -- counting only the six headline groups
 *  put Naban, Dean of Iteration first in an Inalla deck (round 3). Background help counts too:
 *  Herald's Horn and Maskwood Nexus sat on the list while saying they help 30 and 50 cards
 *  (round 4). A card whose job is removal, ramp or protection is compared with its own kind,
 *  because a link count cannot judge it; hiding those cards instead hid the talismans a tuner
 *  weighs (round 3). */
function cutList(deckCards: EngineCard[], partners: Map<string, Map<string, Pair>>, groups: Map<string, EngineGroup>): { cuts: CutRow[]; jobs: [string, CutRow[]][] } {
  const rows: CutRow[] = deckCards.filter((c) => !c.isCommander && !c.isLand).map((card) => {
    const nb = partners.get(card.id) ?? new Map<string, Pair>();
    let real = 0, gives = 0, once = 0, keep: Link | undefined;
    for (const p of nb.values()) {
      const rep = p.links.filter((l) => l.repeat !== "oneshot");
      if (!rep.length) { once++; continue; }
      if (rep.every((l) => isHelperTag(l.tag))) {
        if (rep.some((l) => l.from === card.id)) gives++;
        continue;
      }
      real++;
      const cand = rep.find((l) => groups.has(l.tag) && !isHelperTag(l.tag)) ?? rep.find((l) => !isHelperTag(l.tag))!;
      if (!keep || (groups.has(cand.tag) && !groups.has(keep.tag))) keep = cand;
    }
    if (!keep && gives) {
      for (const p of nb.values()) { const l = p.links.find((x) => x.from === card.id && isHelperTag(x.tag) && x.repeat !== "oneshot"); if (l) { keep = l; break; } }
    }
    let why: string;
    if (!nb.size) why = "Works with nothing else in this deck.";
    else if (!real && !gives) why = once ? `Everything it does with other cards happens only once (${once} card${s(once)}).` : `Its only links come from cards that make others cheaper, or easier to find or bring back.`;
    else if (!real) why = `All it does here is help ${gives} card${s(gives)} in the background, by making them cheaper, giving them types, or letting you find or bring them back.`;
    else why = `Keeps working with only ${real} other card${s(real)}${gives ? `, and helps ${gives} more in the background` : ""}.`;
    const jobs = [...new Set(card.roles.filter((r) => JOB_WORDS[r]).map((r) => JOB_WORDS[r]!))];
    return { card, real, gives, once, partners: nb.size, why, keep, jobs };
  }).sort((a, b) => (a.real + a.gives) - (b.real + b.gives) || a.partners - b.partners || a.card.score - b.card.score || (a.card.name < b.card.name ? -1 : 1));
  const byJob = new Map<string, CutRow[]>();
  for (const r of rows) for (const j of r.jobs) { if (!byJob.has(j)) byJob.set(j, []); byJob.get(j)!.push(r); }
  return {
    cuts: rows.filter((r) => !r.jobs.length).slice(0, 6),
    jobs: [...byJob.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)),
  };
}
