import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, collectTokenNodes, loadHierarchy } from "./index.js";
import { detectWincons } from "./wincon.js";
import { createsForYou } from "./edges.js";
import { synthesizeTokenTags } from "./token-tags.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/opp-token-perspective.json" with { type: "json" };

/** #1666: a token an opponent receives from your card (Overencumbered's Clue, Food and Junk; Generous Gift's Elephant) is read from the opponent's seat. A payoff of any control or of an opponent's still hears it
 *  (Disciple of the Vault, Mayhem Devil, Kothophed); a payoff of tokens or creatures "you control" does not. Cards and token rows dumped from Mongo 2026-11-20 (DERIVE 557: derived rows carry the #1666 review's seat fixes). */
const F = fixtures as unknown as { cards: Record<string, { source: Record<string, unknown>; tags: CardTags }>; tokens: Record<string, CardTags> };
const dc = (name: string): DeckCard => ({ card: F.cards[name]!.source as unknown as DeckCard["card"], tags: F.cards[name]!.tags });
const vanilla = (name: string, typeLine: string, p: string): CardTags => synthesizeTokenTags({ _id: `test-${name}`, name, typeLine, ...(p ? { power: p, toughness: p } : {}), colors: name === "Samurai" || name === "Spirit" ? ["W"] : name === "Inkling" ? ["W", "B"] : name === "Plant" || name === "Elephant" || name === "Beast" ? ["G"] : [], keywords: name === "Samurai" ? ["Vigilance"] : [], printingIds: [] });
const VANILLA: Record<string, [string, string]> = {
  Elephant: ["Token Creature — Elephant", "3"], Beast: ["Token Creature — Beast", "3"], Samurai: ["Token Creature — Samurai", "2"], Plant: ["Token Creature — Plant", "0"], Spirit: ["Token Creature — Spirit", "1"],
  Inkling: ["Token Creature — Inkling", "2"], Treasure: ["Token Artifact — Treasure", ""],
};
const tokenTags = (ref: { name: string }): CardTags | null => F.tokens[ref.name] ?? (VANILLA[ref.name] ? vanilla(ref.name, VANILLA[ref.name]![0], VANILLA[ref.name]![1]) : null);
const report = (names: string[]) => analyzeDeckStructured(names.map(dc), undefined, H, undefined, undefined, undefined, tokenTags as never);
const H = loadHierarchy();
const partners = (maker: string, others: string[]): string[] => {
  const r = analyzeDeckStructured([dc(maker), ...others.map(dc)], undefined, H, undefined, undefined, undefined, tokenTags as never);
  return r.cards.find((c) => c.name === maker)!.topPartners.map((p) => p.name);
};

describe("Overencumbered: the Clue, Food and Junk an opponent receives", () => {
  test.each(["Disciple of the Vault", "Mayhem Devil", "Mazirek, Kraul Death Priest", "Molder Beast", "Ygra, Eater of All"])("is heard by %s, which hears an artifact of any controller", (payoff) => {
    expect(partners("Overencumbered", [payoff])).toContain(payoff);
  });
  test("is NOT heard by Kami of Celebration, whose 'cast from exile' is yours: the Junk impulse is the opponent's", () => {
    expect(partners("Overencumbered", ["Kami of Celebration"])).not.toContain("Kami of Celebration");
  });
  test("is NOT heard by Rings of Brighthearth: it copies an ability YOU activate, and the Junk's is the opponent's", () => {
    expect(partners("Overencumbered", ["Rings of Brighthearth"])).not.toContain("Rings of Brighthearth");
  });
  test("is heard by Return the Favor, which copies a targeted ability of any controller", () => {
    expect(partners("Overencumbered", ["Return the Favor"])).toContain("Return the Favor");
  });
  test("the token nodes read from the opponent's seat, and the node names stay the token's", () => {
    const r = analyzeDeckStructured([dc("Overencumbered"), dc("Disciple of the Vault")], undefined, H, undefined, undefined, undefined, tokenTags as never);
    expect(r.tokenNodes!.map((t) => t.name).sort()).toEqual(["Clue", "Food", "Junk"]);
  });
});

describe("Generous Gift: the Elephant an opponent receives", () => {
  test.each(["Kothophed, Soul Hoarder", "Patron of the Nezumi"])("is heard by %s, which hears a permanent that is not yours", (payoff) => {
    expect(partners("Generous Gift", [payoff])).toContain(payoff);
  });
  test("is heard by Blood Seeker, a creature entering under an OPPONENT's control: the Elephant enters under theirs", () => {
    expect(partners("Generous Gift", ["Blood Seeker"])).toContain("Blood Seeker");
  });
  test("is NOT heard by Impact Tremors, a creature entering under YOUR control", () => {
    expect(partners("Generous Gift", ["Impact Tremors"])).not.toContain("Impact Tremors");
  });
});

test("Beast Within's Beast is an opponent's node of its own, named for the token", () => {
  const r = analyzeDeckStructured([dc("Beast Within"), dc("Kothophed, Soul Hoarder")], undefined, H, undefined, undefined, undefined, tokenTags as never);
  expect(r.tokenNodes!.map((t) => t.name)).toEqual(["Beast"]);
  expect(r.cards.find((c) => c.name === "Beast Within")!.topPartners.map((p) => p.name)).toContain("Kothophed, Soul Hoarder");
});

// REVIEW (#1666): the seat is read from derive's emit, so the nodes must split, name and refuse as the review's probes showed.
describe("seats of one token", () => {
  const nodes = (names: string[]) => collectTokenNodes(names.map(dc), tokenTags as never).nodes;
  test("a deck with An Offer You Can't Refuse and a maker that gives YOU a Treasure has two nodes: the plain Treasure and Treasure (opponent's), whose oracle id and seat mark it", () => {
    const r = report(["An Offer You Can't Refuse", "Unexpected Windfall"]);
    expect(r.tokenNodes!.map((t) => t.name).sort()).toEqual(["Treasure", "Treasure (opponent's)"]);
    const ns = nodes(["An Offer You Can't Refuse", "Unexpected Windfall"]);
    const opp = ns.find((n) => n.card.name === "Treasure (opponent's)")!, mine = ns.find((n) => n.card.name === "Treasure")!;
    expect(opp.tags!.oracleId.endsWith("#opp")).toBe(true);
    expect(opp.tags!.characteristics.heldByOpponent).toBe(true);
    expect(mine.tags!.oracleId.endsWith("#opp")).toBe(false);
    expect(mine.tags!.characteristics.heldByOpponent).toBeUndefined();
    expect(r.tokenNodes!.find((t) => t.name === "Treasure")!.madeBy).toEqual(["Unexpected Windfall"]);
    expect(r.tokenNodes!.find((t) => t.name === "Treasure (opponent's)")!.madeBy).toEqual(["An Offer You Can't Refuse"]);
  });
  test("orchestrate's call (collectTokenNodes on the unsplit deck, default hierarchy) names the nodes as analyzeDeckStructured does, a double-faced maker among them", () => {
    const deck = ["An Offer You Can't Refuse", "Unexpected Windfall", "Dowsing Dagger // Lost Vale", "Eiganjo Uprising"];
    const viaOrchestrate = collectTokenNodes(deck.map(dc), tokenTags as never).nodes.map((n) => `${n.card.name}|${n.tags!.oracleId}`).sort();
    const viaAnalyze = report(deck).tokenNodes!.map((t) => t.name).sort();
    expect(viaOrchestrate.map((x) => x.split("|")[0]).sort()).toEqual(viaAnalyze);
    expect(viaAnalyze).toContain("Plant");
  });
  test("a maker that splits its token (Eiganjo Uprising: yours, and X minus one for each opponent) creates both nodes and pairs with Blood Seeker through the opponent's", () => {
    const r = report(["Eiganjo Uprising", "Blood Seeker"]);
    expect(r.tokenNodes!.map((t) => t.name).sort()).toEqual(["Samurai", "Samurai (opponent's)"]);
    expect(r.tokenNodes!.every((t) => (t.madeBy ?? []).join() === "Eiganjo Uprising")).toBe(true);
    expect(r.cards.find((c) => c.name === "Eiganjo Uprising")!.topPartners.map((p) => p.name)).toContain("Blood Seeker");
  });
  test("a token derive stores for an opponent only where the printed text has YOU creating it (Tempting Contract) is the maker of BOTH seats' Treasure", () => {
    expect(report(["Tempting Contract"]).tokenNodes!.map((t) => t.name).sort()).toEqual(["Treasure", "Treasure (opponent's)"]);
    expect(nodes(["Tempting Contract"]).map((n) => n.tags!.characteristics.heldByOpponent).sort()).toEqual([true, undefined]);
  });
  test("Tempting Contract is the creator of its own Treasure and pairs with Captain Lannery Storm, who hears only YOUR sacrificed Treasure (\"Whenever you sacrifice a Treasure\"); An Offer You Can't Refuse, whose Treasure is the opponent's, does not", () => {
    expect(partners("Tempting Contract", ["Captain Lannery Storm"])).toContain("Captain Lannery Storm");
    expect(partners("An Offer You Can't Refuse", ["Captain Lannery Storm"])).not.toContain("Captain Lannery Storm");
  });
  test("createsForYou accepts Tempting Contract on both its nodes, and An Offer You Can't Refuse on the opponent's only", () => {
    const ns = nodes(["Tempting Contract", "An Offer You Can't Refuse"]);
    const mine = ns.find((n) => n.card.name === "Treasure")!, theirs = ns.find((n) => n.card.name === "Treasure (opponent's)")!;
    expect([createsForYou(dc("Tempting Contract"), mine, H), createsForYou(dc("Tempting Contract"), theirs, H)]).toEqual([true, true]);
    expect([createsForYou(dc("An Offer You Can't Refuse"), mine, H), createsForYou(dc("An Offer You Can't Refuse"), theirs, H)]).toEqual([false, true]);
  });
  test("Jolene's Treasure goes to whoever attacked: the plain node, not an opponent's", () => {
    expect(report(["Jolene, the Plunder Queen"]).tokenNodes!.map((t) => t.name)).toEqual(["Treasure"]);
    expect(nodes(["Jolene, the Plunder Queen"]).map((n) => n.tags!.characteristics.heldByOpponent)).toEqual([undefined]);
    expect(report(["Combat Calligrapher"]).tokenNodes!.map((t) => t.name)).toEqual(["Inkling"]);
  });
  test("Teysa's Clue is yours: she pairs with Tireless Tracker and not with the opponent-draw payoffs Orcish Bowmasters and Smothering Tithe", () => {
    const p = partners("Teysa, Opulent Oligarch", ["Orcish Bowmasters", "Smothering Tithe", "Tireless Tracker"]);
    expect(p).not.toContain("Orcish Bowmasters");
    expect(p).not.toContain("Smothering Tithe");
    expect(p).toContain("Tireless Tracker");
  });
});

// ROUND 4: a token paid per REMOVED permanent is the victim's board, whoever derive says gets it (it reads `any` for a wipe or a "for each ... this way"), so it is no go-wide plan (#574). A token you simply make still is.
describe("go-wide", () => {
  const goWide = (n: string): boolean => detectWincons([dc(n)]).get("go-wide")?.has(n) === true;
  test.each(["March of Souls", "The Phasing of Zhalfir", "Rampage of the Clans", "The Curse of Fenric", "Curse of the Swine", "Soul of Emancipation", "Rowan, Scholar of Sparks // Will, Scholar of Frost", "Terastodon", "Descent of the Dragons", "Hour of Need"])("%s: a token handed to each removed permanent's controller is not a go-wide card", (n) => {
    expect(goWide(n)).toBe(false);
  });
  test.each(["Combat Calligrapher", "Ellie, Brick Master", "Curse of Shallow Graves", "Parallel Evolution"])("%s: a token the attacker or the copier makes is", (n) => {
    expect(goWide(n)).toBe(true);
  });
});
