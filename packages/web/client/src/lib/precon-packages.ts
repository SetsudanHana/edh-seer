/** THE PRECON UPGRADE PACKAGES (#767, task 7), one per bracket target, for `build-precons`. The
 *  choosing is the matcher's (`upgrade-sections`, `bracket-guard`, `upgrade-gatherer`); this joins it
 *  to the report the page is built from: which cards the report lets a role section cut, which cards
 *  the deck's links protect, and the synergy pairs the suggestions already made.
 *
 *  ONE LOOKUP FOR THE WHOLE BUILD. The candidate pools are most of the corpus's noncreature role
 *  cards and every land; passed the same `StaticLookup` for every precon, each shard is read once. */
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName } from "@edh-seer/data/names";
import { bringDown } from "@edh-seer/matcher/bracket-guard";
import { slugOf } from "@edh-seer/matcher/slug";
import type { StaticLookup } from "@edh-seer/matcher/static-lookup";
import type { DeckSuggestions } from "@edh-seer/matcher/suggest-static";
import { gatherPackage } from "@edh-seer/matcher/upgrade-gatherer";
import { BRACKET_TARGETS, type BracketTarget, type UpgradePackage } from "@edh-seer/matcher/upgrade-package";
import { synergyReasons } from "@edh-seer/matcher/upgrade-reasons";
import { upgradeOptions } from "@edh-seer/matcher/upgrade-sections";
import type { Card } from "@edh-seer/engine";
import type { DeckBracket } from "@edh-seer/matcher/brackets";
import type { AnalyzeResponse } from "../types.js";
import { roleSwapCuts } from "./cut-choice.js";
import type { EngineModel } from "./engine-model.js";
import type { PreconCard } from "./precon-page.js";

export interface PreconPackages {
  packages: UpgradePackage[];
  /** Targets no cut can reach (a commander that is a Game Changer, a combo of commanders alone). */
  unreachable: BracketTarget[];
  /** Slug and art for every card a package adds, by name. */
  cards: Record<string, PreconCard>;
}

export async function preconPackages(input: {
  lookup: StaticLookup;
  commanders: readonly string[];
  deckNames: readonly string[];
  data: AnalyzeResponse;
  model: EngineModel | null;
  suggestions: DeckSuggestions | null;
  /** The deck by name and count, commanders apart, for re-analysing it with a package's swaps made. */
  cards: readonly { name: string; count: number }[];
  /** The report's own reading of a decklist: its band and its mana base total. When given, every
   *  package is checked against it (H5), and a package that makes the mana base worse loses swaps. */
  analyse?: (decklist: string) => Promise<{ band: DeckBracket["band"]; mana: number; synergy: number }>;
}): Promise<PreconPackages> {
  const { lookup, data } = input;
  const report = data.report;
  const band = report.bracket?.band ?? "1-2";
  // LINKS, as the report counts them: the distinct deck cards each card forms an edge with.
  const partners = new Map<string, Set<string>>();
  for (const e of report.edges) {
    partners.set(e.a, (partners.get(e.a) ?? new Set()).add(e.b));
    partners.set(e.b, (partners.get(e.b) ?? new Set()).add(e.a));
  }
  const links = new Map([...partners].map(([n, s]) => [n, s.size] as const));

  await lookup.prefetch(input.deckNames.map(normalizeName));
  const cardOf = async (name: string): Promise<Card | undefined> => {
    const doc = await lookup.findByName(normalizeName(name));
    return doc ? docToCard(doc) : undefined;
  };
  const deck = (await Promise.all(input.deckNames.map(cardOf))).filter((c): c is Card => !!c);
  const deckCombos = await lookup.allCombos();
  const downs = new Map(BRACKET_TARGETS.map((t) => [t, bringDown(deck, deckCombos, t, input.commanders, links)] as const));

  const options = await upgradeOptions({
    lookup, deckNames: input.deckNames, commanders: input.commanders, identity: data.commanderColorIdentity ?? [],
    roleCuts: roleSwapCuts(report, input.model),
    bringDownCuts: [...new Set([...downs.values()].flatMap((d) => d.cuts.map((c) => c.name)))],
  });
  // EVERY CARD ANY OPTION COULD ADD, for the guard and for the page's pictures.
  const addNames = new Set<string>([
    ...Object.values(options.roles).flatMap((cs) => cs.flatMap((c) => c.options.map((o) => o.add))),
    ...options.lands.flatMap((c) => c.options.map((o) => o.add)),
    ...[...options.replacements.values()].flatMap((rs) => rs.map((r) => r.add)),
    ...(input.suggestions?.pairs ?? []).map((p) => p.add.name),
  ]);
  await lookup.prefetch([...addNames].map(normalizeName));
  const addCards = new Map<string, Card>();
  const cards: Record<string, PreconCard> = {};
  for (const n of addNames) {
    const doc = await lookup.findByName(normalizeName(n));
    if (!doc) continue;
    addCards.set(n, docToCard(doc));
    const art = doc.artCrop ?? doc.faces?.[0]?.artCrop;
    cards[n] = { name: n, slug: slugOf(n), ...(art ? { art } : {}) };
  }
  // THE COMBOS THE ADDS BRING: fetched with them, so a combo an add completes is seen by the guard.
  const combos = await lookup.allCombos();
  const synergy = (input.suggestions?.pairs ?? []).map((p) => {
    const r = synergyReasons({ name: p.cut, connections: p.cutConnections }, { name: p.add.name, connections: p.add.connections.length, reason: p.add.reasons[0]?.text ?? `${p.add.name} works with more of this deck's cards` });
    return { out: p.cut, in: p.add.name, outReason: r.out, inReason: r.in };
  });

  const packages: UpgradePackage[] = [];
  const unreachable: BracketTarget[] = [];
  for (const target of BRACKET_TARGETS) {
    const pkg = gatherPackage({
      target, from: band, deck, combos, cardOf: (n) => addCards.get(n), inDeck: new Set(input.deckNames), bringDown: downs.get(target)!,
      replacements: options.replacements, roles: options.roles, lands: options.lands, synergy,
    });
    if (pkg) packages.push(input.analyse ? await keepManaBase(pkg, input, addCards) : pkg); else unreachable.push(target);
  }
  // Only the cards the packages actually add travel with the page.
  const used = new Set(packages.flatMap((p) => [...p.bringDown, ...p.sections.flatMap((s) => s.swaps)].map((s) => s.in.name)));
  return { packages, unreachable, cards: Object.fromEntries(Object.entries(cards).filter(([n]) => used.has(n))) };
}

/** Every coloured pip a card asks for: how much it leans on the mana base. */
const pips = (c: Card | undefined) => ((c?.manaCost ?? "").match(/\{[^}]*[WUBRG][^}]*\}/g) ?? []).length;

/** The precon with a package's swaps made, as a decklist. */
function swappedList(commanders: readonly string[], cards: readonly { name: string; count: number }[], pkg: UpgradePackage): string {
  const left = cards.map((c) => ({ ...c }));
  const swaps = [...pkg.bringDown, ...pkg.sections.flatMap((s) => s.swaps)];
  for (const s of swaps) { const c = left.find((x) => x.name === s.out.name && x.count > 0); if (c) c.count--; }
  return ["Commander", ...commanders.map((c) => `1 ${c}`), "", "Deck",
    ...left.filter((c) => c.count > 0).map((c) => `${c.count} ${c.name}`), ...swaps.map((s) => `1 ${s.in.name}`)].join("\n");
}

/** THE MANA BASE MUST NOT GET WORSE (H5, pre-registered). The report's own mana base score reads the
 *  whole deck -- colours asked against colours made, tapped lands, the land count against a target
 *  that moves with the curve -- so a synergy card asking for {U}{U}{U}{R}{R}{R} can cost more than
 *  every land swap gains (Political Puppets, 2026-09-30). The package is read back through the same
 *  analysis; while it is worse, the non-land swap whose card asks most of the deck's colours goes.
 *  Land swaps never go: none loses a colour the deck needs or enters tapped more often. */
async function keepManaBase(pkg: UpgradePackage, input: { commanders: readonly string[]; cards: readonly { name: string; count: number }[]; data: AnalyzeResponse; analyse?: (decklist: string) => Promise<{ band: DeckBracket["band"]; mana: number; synergy: number }> }, addCards: ReadonlyMap<string, Card>): Promise<UpgradePackage> {
  const before = input.data.report.deckMath?.lands.manaBase?.total;
  if (before === undefined || !input.analyse) return pkg;
  let current = pkg;
  for (let i = 0; i < 12; i++) {
    const after = await input.analyse(swappedList(input.commanders, input.cards, current));
    // THE NUMBERS THE PAGE QUOTES ARE THE ONES THIS READING GAVE, for the package as it ships.
    if (after.mana <= before) return { ...current, after };
    const heaviest = current.sections.filter((s) => s.id !== "lands").flatMap((s) => s.swaps)
      .sort((a, b) => pips(addCards.get(b.in.name)) - pips(addCards.get(a.in.name)))[0];
    if (!heaviest) break;
    current = { ...current, sections: current.sections.map((s) => ({ ...s, swaps: s.swaps.filter((w) => w !== heaviest) })) };
  }
  return current;
}
