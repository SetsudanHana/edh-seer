/** THE PRECON UPGRADE PACKAGES (#767, task 7), one per bracket target, for `build-precons`. The
 *  choosing is the matcher's (`upgrade-sections`, `bracket-guard`, `upgrade-gatherer`); this joins it
 *  to the report the page is built from: which cards the report lets a role section cut, which cards
 *  the deck's links protect, and the synergy pairs the suggestions already made.
 *
 *  ONE LOOKUP FOR THE WHOLE BUILD. The candidate pools are most of the corpus's noncreature role
 *  cards and every land; passed the same `StaticLookup` for every precon, each shard is read once. */
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName } from "@edh-seer/data/names";
import { bringDown, fitsTarget } from "@edh-seer/matcher/bracket-guard";
import { slugOf } from "@edh-seer/matcher/slug";
import type { StaticLookup } from "@edh-seer/matcher/static-lookup";
import type { DeckSuggestions } from "@edh-seer/matcher/suggest-static";
import { gatherPackage } from "@edh-seer/matcher/upgrade-gatherer";
import { BRACKET_TARGETS, bandFits, type BracketTarget, type UpgradePackage, type UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import { bringDownInReason, jobOf, synergyReasons } from "@edh-seer/matcher/upgrade-reasons";
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

/** The report's reading of a decklist: its band, its mana base total and its synergy score. */
type Reading = { band: DeckBracket["band"]; mana: number; synergy: number };

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
  analyse?: (decklist: string) => Promise<Reading>;
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
  // ONLY A CUT THAT DOES NO JOB: a removal or protection card is the role sections' to replace, by
  // their strict rule (persona round 2026-10-02: Sunfall for Underhanded Designs, Path to Exile for
  // Syr Vondam, under "Cards that work together").
  const synergy = (input.suggestions?.pairs ?? []).filter((p) => p.rule === "no-role").map((p) => {
    const r = synergyReasons({ name: p.cut, ...p.cutStrength }, { name: p.add.name, ...p.addStrength, reason: p.add.reasons[0]?.text ?? `${p.add.name} does more for this deck's theme` });
    return { out: p.cut, in: p.add.name, outReason: r.out, inReason: r.in };
  });

  const packages: UpgradePackage[] = [];
  const unreachable: BracketTarget[] = [];
  for (const target of BRACKET_TARGETS) {
    const pkg = gatherPackage({
      target, from: band, deck, combos, cardOf: (n) => addCards.get(n), inDeck: new Set(input.deckNames), bringDown: downs.get(target)!,
      replacements: options.replacements, roles: options.roles, lands: options.lands, synergy,
    });
    if (!pkg) { unreachable.push(target); continue; }
    /** THE OTHER CARDS THAT COULD FILL A BRING-DOWN CUT'S SLOT: its replacements after the one taken,
     *  among the first `REPLACEMENTS_TRIED`, not already in the deck or the package, that keep the deck
     *  under the target by the guard. */
    const alternatives = (p: UpgradePackage, swap: UpgradeSwap): UpgradeSwap[] => {
      const cut = downs.get(target)!.cuts.find((c) => c.name === swap.out.name);
      const all = [...p.bringDown, ...p.sections.flatMap((s) => s.swaps)];
      const taken = new Set(all.map((w) => w.in.name));
      const rs = options.replacements.get(swap.out.name) ?? [];
      const from = rs.findIndex((r) => r.add === swap.in.name);
      return !cut || from < 0 ? [] : rs.slice(from + 1, REPLACEMENTS_TRIED).filter((r) => {
        const card = addCards.get(r.add);
        if (!card || taken.has(r.add) || input.deckNames.includes(r.add)) return false;
        const adds = [...all.filter((w) => w !== swap).map((w) => addCards.get(w.in.name)).filter((c): c is Card => !!c), card];
        return fitsTarget(deck, combos, all.map((w) => w.out.name), adds, target);
      }).map((r) => ({ ...swap, in: { name: r.add, reason: bringDownInReason(r.add, cut, jobOf(r.role)) }, role: r.role }));
    };
    packages.push(input.analyse ? await keepManaBase(pkg, input, alternatives) : pkg);
  }
  // Only the cards the packages actually add travel with the page.
  const used = new Set(packages.flatMap((p) => [...p.bringDown, ...p.sections.flatMap((s) => s.swaps)].map((s) => s.in.name)));
  return { packages, unreachable, cards: Object.fromEntries(Object.entries(cards).filter(([n]) => used.has(n))) };
}

/** The precon with a package's swaps made, as a decklist. */
function swappedList(commanders: readonly string[], cards: readonly { name: string; count: number }[], pkg: UpgradePackage): string {
  const left = cards.map((c) => ({ ...c }));
  const swaps = [...pkg.bringDown, ...pkg.sections.flatMap((s) => s.swaps)];
  for (const s of swaps) { const c = left.find((x) => x.name === s.out.name && x.count > 0); if (c) c.count--; }
  return ["Commander", ...commanders.map((c) => `1 ${c}`), "", "Deck",
    ...left.filter((c) => c.count > 0).map((c) => `${c.count} ${c.name}`), ...swaps.map((s) => `1 ${s.in.name}`)].join("\n");
}

/** How far down a bring-down cut's replacements the keeper looks; each costs a reading of the deck. */
const REPLACEMENTS_TRIED = 5;
const count = (p: UpgradePackage) => p.bringDown.length + p.sections.reduce((n, s) => n + s.swaps.length, 0);

/** THE PACKAGE MUST FIT ITS TARGET AND LEAVE THE MANA BASE NO WORSE (H1 and H5, pre-registered), by
 *  the report's own reading of the swapped list. The mana base score reads the whole deck -- colours
 *  asked against colours made, tapped lands, the land count against a target that moves with the
 *  curve -- so a synergy card asking for {U}{U}{U}{R}{R}{R} can cost more than every land swap gains
 *  (Political Puppets, 2026-09-30). And the report's band reads combos the guard's list may not.
 *
 *  While the package misses either, the keeper makes one move: it drops a non-land swap, or gives a
 *  bring-down cut its next replacement (Rona for Notion Thief lowered the curve, and so the land
 *  target, under The Hosts of Mordor's 37 lands, 2026-09-30). Every move is tried out and the one
 *  that reads best is made: in the target's band first, then the least mana base cost over the
 *  precon's, then the fewest swaps lost, then the most synergy kept. No single feature of a card says which that is: dropping
 *  by coloured pips cost mono-red Built From Scratch every swap, its total moving with the curve
 *  alone (2026-09-30). Land swaps never go: none loses a colour the deck needs or enters tapped more
 *  often. */
export async function keepManaBase(
  pkg: UpgradePackage,
  input: { commanders: readonly string[]; cards: readonly { name: string; count: number }[]; data: AnalyzeResponse; analyse?: (decklist: string) => Promise<Reading> },
  alternatives: (p: UpgradePackage, swap: UpgradeSwap) => UpgradeSwap[],
): Promise<UpgradePackage> {
  const before = input.data.report.deckMath?.lands.manaBase?.total;
  const analyse = input.analyse;
  if (before === undefined || !analyse) return pkg;
  const read = (p: UpgradePackage) => analyse(swappedList(input.commanders, input.cards, p));
  const fits = (r: Reading) => bandFits(r.band, pkg.target) && r.mana <= before;
  const rank = (r: Reading, lost: number) => [bandFits(r.band, pkg.target) ? 0 : 1, Math.max(r.mana - before, 0), lost, -r.synergy];
  const beats = (a: number[], b: number[]) => { const i = a.findIndex((v, j) => v !== b[j]); return i >= 0 && a[i]! < b[i]!; };
  let current = pkg;
  let reading = await read(current);
  while (!fits(reading)) {
    // EACH MOVE THE KEEPER MAY MAKE: drop a non-land swap, or give a bring-down cut its next replacement.
    const moves: UpgradePackage[] = [
      ...current.sections.filter((s) => s.id !== "lands").flatMap((s) => s.swaps)
        .map((w) => ({ ...current, sections: current.sections.map((s) => ({ ...s, swaps: s.swaps.filter((x) => x !== w) })) })),
      ...current.bringDown.flatMap((w) => alternatives(current, w).slice(0, 1)
        .map((alt) => ({ ...current, bringDown: current.bringDown.map((x) => (x === w ? alt : x)) }))),
    ];
    if (moves.length === 0) return current;
    let best: { pkg: UpgradePackage; reading: Reading; rank: number[] } | null = null;
    for (const next of moves) {
      const r = await read(next);
      const k = rank(r, count(current) - count(next));
      if (!best || beats(k, best.rank)) best = { pkg: next, reading: r, rank: k };
    }
    current = best!.pkg;
    reading = best!.reading;
  }
  // THE NUMBERS THE PAGE QUOTES ARE THE ONES THIS READING GAVE, for the package as it ships.
  return { ...current, after: reading };
}
