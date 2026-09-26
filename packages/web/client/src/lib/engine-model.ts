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
  /** Printed mana cost from the report, so a cut can be weighed by what it costs (round 6). */
  manaCost: string;
  /** For a card's other face, the name its front goes by: "Trance Kuja" and "Kuja, Genome
   *  Sorcerer" read as two different cards (round 12). */
  faceOf?: string;
  /** The physical card this node is a face of, or its own name: what a player cuts. */
  physical: string;
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
  /** Set when most of this group's members already make up a group above it: four Inalla groups
   *  listed the same 36 Wizards, and the phone seat stopped scrolling at the second (round 6). The
   *  view names that group and draws only the difference. */
  sameAs?: { name: string; extra: string[]; missing: string[] };
}

export interface CutRow {
  card: EngineCard;
  /** Other cards it keeps working with, counting every repeating link that is not a helper's. */
  real: number;
  /** Cards it helps in the background: made cheaper, given types, found or brought back. */
  gives: number;
  /** Cards it helps once in the background: found or brought back a single time. Half weight. */
  givesOnce: number;
  once: number; partners: number;
  why: string;
  keep?: Link;
  /** Whether the card's own text does the work in `keep`. When it does not, the card only feeds
   *  other cards, and the view says so instead of calling a line any Wizard would get its "best
   *  reason to keep it" (round 7). */
  keepActs: boolean;
  /** Partners that use this card while its own text does nothing with them. */
  fed: number;
  /** Their names, the least shared first: a feeder names who uses it, so two feeders never read the
   *  same (round 8, where one sentence repeated on four cards and read as a verdict on them). */
  fedBy: string[];
  /** Cards used by exactly the same cards as this one, folded into its row: they are
   *  interchangeable here, and three tiles repeating "the same 7 cards as Calculating Lich" read as
   *  padding (round 10). */
  twins: string[];
  /** A card in the deck that can bring this one back, so its one-time links happen again. */
  broughtBackBy?: string;
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
  /** Every card the cut ranking weighed, weakest first: the report's cut list reads its wording. */
  cutRows: CutRow[];
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
  // THE PARTY IS NOT A TYPE: `scales:party` (#490) counts up to one each of Cleric, Rogue, Warrior
  // and Wizard, and "Counts your Parties" read as a card type that does not exist.
  if (subject === "party") return "party members";
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
  const costByName = new Map(report.cards.map((c) => [c.name, c.manaCost ?? ""]));
  const commanders = new Set(report.commanders);
  const cards = new Map<string, EngineCard>();
  for (const n of graph.nodes) {
    cards.set(n.id, {
      id: n.id, name: n.label, typeLine: n.typeLine ?? "", text: n.oracleText ?? "", art: n.artCrop,
      isToken: n.isToken === true, isCommander: commanders.has(n.cardName ?? n.id),
      isLand: (n.types ?? []).includes("land"), isFace: n.cardName !== undefined && n.cardName !== n.id,
      roles: n.roles ?? [], score: scoreByName.get(n.label) ?? 0,
      manaCost: n.isToken ? "" : costByName.get(n.cardName ?? n.label) ?? "",
      physical: n.cardName ?? n.id,
      faceOf: n.cardName && n.cardName !== n.id && n.cardName.split(" // ")[0] !== n.label ? n.cardName.split(" // ")[0] : undefined,
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
  for (const [i, g] of groups.entries()) {
    const mine = new Set(g.members);
    const before = groups.slice(0, i).filter((h) => h.helper === g.helper && h.members.length >= 8)
      .map((h) => ({ h, shared: h.members.filter((x) => mine.has(x)).length }))
      .filter(({ h, shared }) => shared >= 0.8 * mine.size && shared >= 0.8 * h.members.length)
      .sort((x, y) => y.shared - x.shared)[0];
    if (!before) continue;
    const theirs = new Set(before.h.members);
    g.sameAs = { name: before.h.name, extra: g.members.filter((x) => !theirs.has(x)), missing: before.h.members.filter((x) => !mine.has(x)) };
  }
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
    ...cutList(deckCards, cards, partners, groupByTag),
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
    // An effect the engine has not read does not rank a pair: two Rikku pairs sat in the top three
    // on lines that said "effect not read yet" (round 11).
    const rep = pair.links.filter((l) => l.repeat !== "oneshot" && !isHelperTag(l.tag) && !unread(l));
    if (!rep.length) return [];
    const ways = [...new Set(rep.map((l) => groups.get(l.tag)?.name ?? groupName(l.tag)))];
    const actor = helper;
    const both = new Set(rep.map(actor)).size > 1;
    const strength = ways.length + (both ? 1.5 : 0) + (a.isCommander || b.isCommander ? 1 : 0) + (3 * (a.score + b.score)) / (2 * smax);
    // Both directions on screen when it goes both ways, so "each helps the other" is visible.
    const ordered = [...rep].sort((x, y) => REPEAT_ORDER[x.repeat] - REPEAT_ORDER[y.repeat]);
    const first = ordered[0]!;
    const back = ordered.find((l) => actor(l) !== actor(first));
    // One line per way after that, so "in 2 ways" never sits over three lines (round 6).
    const way = (l: Link) => groups.get(l.tag)?.name ?? groupName(l.tag);
    const shown = new Set([first, ...(back ? [back] : [])].map(way));
    const more = ordered.filter((l) => l !== first && l !== back && !shown.has(way(l)) && shown.add(way(l)));
    const lines = [first, ...(back ? [back] : []), ...more].slice(0, 3);
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

/** A reason whose effect half the engine has not read ends in "triggers" (the same test as
 *  `unreadEffect` in card-drawer, kept here so this module stays free of components). It is true
 *  but says nothing, so it is never offered as the reason to keep a card (live round, 2026-09-25). */
const unread = (l: Link) => /\btriggers$/.test(l.text.trim());

/** WHO HELPS WHOM in a link: the producer -- the card whose event another card's ability uses --
 *  except where the engine names them the other way round. A recursion link's producer is the card
 *  in the graveyard ("When Fat Chocobo is in the graveyard, Yuna can bring it back": Yuna helps,
 *  round 7), and a copy link's producer is the card whose ability gets copied (Weaver of Harmony
 *  helps Sythis by copying it, round 9). Not "the card that acts": in "When Weaver is cast, Sythis
 *  gains you life" Sythis acts and Weaver helped, which read as each helping the other. */
function helper(l: Link): string {
  return /^(graveyard-recursion|copies):/.test(l.tag) ? l.to : l.from;
}

/** Whether a card's own text does the work in a line: the sentence's main clause starts with its
 *  name ("When a creature leaves ... thanks to Essence Flux, Dour Port-Mage draws a card"). Which
 *  side of a link acts differs by tag -- a trigger's consumer acts, a grant's producer does -- so
 *  the sentence is the one place that says it the same way every time. */
function acts(card: EngineCard, l: Link): boolean {
  // A doubler or a copier is what acts, whichever name the sentence leads with: "Pollywog Prodigy's
  // triggered abilities trigger an additional time thanks to Harmonic Prodigy" was every Inalla
  // creature cut's best reason to keep it (round 9).
  if (/^doubles:/.test(l.tag)) return l.from === card.id;
  if (/^copies:/.test(l.tag)) return l.to === card.id;
  const t = l.text.trim();
  const main = /^(when|whenever|while|as long as)\b/i.test(t) && t.includes(", ") ? t.slice(t.indexOf(", ") + 2) : t;
  return main.startsWith(card.name) || main.startsWith(card.name.split(" // ")[0]!) || main.startsWith(card.name.split(", ")[0]!);
}

/** THE CARDS DOING THE LEAST, and removal and ramp judged by their job.
 *
 *  Every repeating link counts, trigger doublers included -- counting only the six headline groups
 *  put Naban, Dean of Iteration first in an Inalla deck (round 3). Background help counts too:
 *  Herald's Horn and Maskwood Nexus sat on the list while saying they help 30 and 50 cards
 *  (round 4), and so does help that happens once, at half weight: Sevinne's Reclamation sat on the
 *  list while its group said it brings back 54 cards (live round). A card whose job is removal,
 *  ramp or protection is compared with its own kind, because a link count cannot judge it; hiding
 *  those cards instead hid the talismans a tuner weighs (round 3).
 *
 *  The reason to keep a card is its own: a line where the card's own text does the work where it
 *  can (see `acts`), then one in the deck's groups, then the most central partner; a
 *  partner a row above already named only breaks ties. Taking the first link gave every Inalla cut
 *  the same line about Inalla making a token (live round); avoiding the commander instead hid Dour
 *  Port-Mage's real reason, and forcing a new partner on every row made the reasons generic --
 *  "Kindred Discovery draws you a card" is true of any Wizard (round 6). */
/** A card's name as a list prints it: a back face says whose back it is. */
export const displayName = (c: EngineCard): string => (c.faceOf ? `${c.name} (back of ${c.faceOf})` : c.name);

/** How much a card does here, for ranking cuts: every repeating link in full, help that happens
 *  once at half, and a link that happens once at a quarter -- counting those at nothing put Ghostly
 *  Flicker, with 26 of them, at the top of Inalla's cuts above cards with six (round 9). A card
 *  something can bring back counts its one-time links in full, since they happen again. */
export const cutWeight = (r: CutRow): number => r.real + r.gives + r.givesOnce / 2 + r.once * (r.broughtBackBy ? 1 : 0.25);

/** "A, B and C" or "A, B, C and 7 others"; semicolons when a name carries its own comma, so
 *  "Falco Spara, Pactweaver" does not read as two cards (round 9). */
export function listNames(list: string[], max = 8): string {
  const short = list.map((n) => n.split(" // ")[0]!);
  const sep = short.some((n) => n.includes(",")) ? "; " : ", ";
  const head = short.slice(0, max), rest = short.length - head.length;
  if (rest > 0) return `${head.join(sep)} and ${rest} other${rest === 1 ? "" : "s"}`;
  return head.length > 1 ? `${head.slice(0, -1).join(sep)} and ${head.at(-1)}` : (head[0] ?? "");
}

function cutList(deckCards: EngineCard[], cards: Map<string, EngineCard>, partners: Map<string, Map<string, Pair>>, groups: Map<string, EngineGroup>): { cuts: CutRow[]; cutRows: CutRow[]; jobs: [string, CutRow[]][] } {
  const rows: (CutRow & { options: Link[] })[] = deckCards.filter((c) => !c.isCommander && !c.isLand).map((card) => {
    const nb = partners.get(card.id) ?? new Map<string, Pair>();
    let real = 0, gives = 0, givesOnce = 0, once = 0, fed = 0;
    const fedBy: EngineCard[] = [], onceWith: EngineCard[] = [], backBy: EngineCard[] = [];
    const options: Link[] = [];
    for (const p of nb.values()) {
      const o = cards.get(p.a === card.id ? p.b : p.a);
      // Something in the deck that can bring this card back, again and again: a one-shot spell that
      // Archaeomancer returns is not a card that works only once (round 9).
      if (o && p.links.some((l) => l.repeat !== "oneshot" && ((/^recursion-target/.test(l.tag) && l.to === card.id) || (/^graveyard-recursion/.test(l.tag) && l.from === card.id)))) backBy.push(o);
      const rep = p.links.filter((l) => l.repeat !== "oneshot");
      if (!rep.length) {
        if (p.links.some((l) => l.from === card.id && isHelperTag(l.tag))) givesOnce++;
        else { once++; if (o) onceWith.push(o); }
        continue;
      }
      if (rep.every((l) => isHelperTag(l.tag))) {
        if (rep.some((l) => l.from === card.id)) gives++;
        continue;
      }
      real++;
      if (!rep.some((l) => acts(card, l))) {
        fed++;
        if (o) fedBy.push(o);
      }
      options.push(...rep.filter((l) => !isHelperTag(l.tag) && !unread(l)));
    }
    const other = (l: Link) => cards.get(l.from === card.id ? l.to : l.from);
    const worth = (l: Link) => (acts(card, l) ? 4 : 0) + (groups.has(l.tag) ? 2 : 0) + (other(l)?.score ?? 0) / 1000;
    options.sort((a, b) => worth(b) - worth(a));
    let keep: Link | undefined = options[0];
    if (!keep && (gives || givesOnce)) {
      const help = [...nb.values()].flatMap((p) => p.links).filter((x) => x.from === card.id && isHelperTag(x.tag) && !unread(x));
      keep = help.find((x) => x.repeat !== "oneshot") ?? help[0];
    }
    const byScore = (x: EngineCard, y: EngineCard) => y.score - x.score || (x.name < y.name ? -1 : 1);
    const onceNames = onceWith.sort(byScore).map(displayName);
    const back = backBy.sort(byScore)[0];
    const onceHelp = givesOnce ? `helps ${givesOnce} more once, by finding them or bringing them back` : "";
    let why: string;
    if (!nb.size) why = "Works with nothing else in this deck.";
    else if (!real && !gives && !givesOnce) why = once
      ? `Everything it does with other cards happens only once: with ${listNames(onceNames, 3)}.${back ? ` ${back.name} can bring it back to do it again.` : ""}`
      : `Its only links come from cards that make others cheaper, or easier to find or bring back.`;
    else if (!real && !gives) why = `All it does here is help ${givesOnce} card${s(givesOnce)} once, by finding them or bringing them back.`;
    else if (!real) why = `All it does here is help ${gives} card${s(gives)} in the background, by making them cheaper, giving them types, or letting you find or bring them back${givesOnce ? `; it also ${onceHelp}` : ""}.`;
    else why = `Keeps working with only ${real} other card${s(real)}${gives ? `, helps ${gives} more in the background` : ""}${givesOnce ? `${gives ? "," : ""} and ${onceHelp}` : ""}.`;
    const jobs = [...new Set(card.roles.filter((r) => JOB_WORDS[r]).map((r) => JOB_WORDS[r]!))];
    // The users few other cards feed come first: they are what is particular about this card.
    // Most central first put "Kindred Discovery, Inalla, Harmonic Prodigy" on every Wizard.
    const reach = (c: EngineCard) => partners.get(c.id)?.size ?? 0;
    const fedNames = fedBy.sort((x, y) => reach(x) - reach(y) || y.score - x.score || (x.name < y.name ? -1 : 1)).map((c) => displayName(c) + (c.isToken ? " (token)" : ""));
    return { card, real, gives, givesOnce, once, fed, fedBy: fedNames, broughtBackBy: back?.name, partners: nb.size, why, keep, keepActs: !!keep && acts(card, keep), twins: [], jobs, options };
  }).sort((a, b) => cutWeight(a) - cutWeight(b) || a.partners - b.partners || a.card.score - b.card.score || (a.card.name < b.card.name ? -1 : 1));
  // A CARD THAT DRIVES A GROUP IS NOT A CUT: Skullclamp sat on the list while "Creatures dying"
  // named it among the cards doing something extra (round 10), and a helper's hub -- the cost
  // reducer, Herald's Horn -- helps a whole group in the background (round 4).
  const drivers = new Set([...groups.values()].flatMap((g) => g.hubs));
  const usersKey = (r: CutRow) => [...r.fedBy].sort().join("\u0001");
  const cuts: typeof rows = [];
  for (const r of rows) {
    if (r.jobs.length || drivers.has(r.card.id)) continue;
    const twin = !r.keepActs && r.fedBy.length ? cuts.find((x) => !x.keepActs && usersKey(x) === usersKey(r)) : undefined;
    if (twin) twin.twins.push(displayName(r.card));
    else if (cuts.length < 6) cuts.push(r);
  }
  const named = new Set<string>();
  for (const r of cuts) {
    const other = (l: Link) => (l.from === r.card.id ? l.to : l.from);
    const tier = (l: Link) => (acts(r.card, l) ? 4 : 0) + (groups.has(l.tag) ? 2 : 0);
    const best = r.options[0];
    const fresh = best && r.options.find((l) => tier(l) === tier(best) && !named.has(other(l)));
    if (fresh) r.keep = fresh;
    if (r.keep) named.add(other(r.keep));
  }
  for (const r of rows) r.keepActs = !!r.keep && acts(r.card, r.keep);
  // Shown in the order of the number each row prints, the ranking's other terms breaking ties:
  // "only 6, 7, 10" above "8, 9, 13" read as a broken ranking to two seats (round 11).
  cuts.sort((a, b) => a.real - b.real || cutWeight(a) - cutWeight(b));
  const byJob = new Map<string, typeof rows>();
  for (const r of rows) for (const j of r.jobs) { if (!byJob.has(j)) byJob.set(j, []); byJob.get(j)!.push(r); }
  return {
    cuts: cuts.map(({ options: _, ...r }) => r),
    cutRows: rows.map(({ options: _, ...r }) => r),
    // Each job runs least to most connected, by the number it prints (round 12: the cut ranking's
    // order broke the box's own rule).
    jobs: [...byJob.entries()].map(([j, rs]) => [j, rs.map(({ options: _, ...r }) => r).sort((x, y) => x.partners - y.partners || (x.card.name < y.card.name ? -1 : 1))] as [string, CutRow[]]).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)),
  };
}
