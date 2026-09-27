import type { DeckSuggestions, SuggestedCard } from "@edh-seer/matcher/suggest-static";
import type { AnalyzeResponse, DeckReport } from "../types.js";
import { primaryType } from "./deck-shape.js";
import { buildEngineModel } from "./engine-model.js";
import { findings } from "./findings.js";
import { mainTheme } from "./main-theme.js";
import { buildOrbit } from "./orbit-model.js";
import { scoreBand } from "./score-band.js";

/** Swaps a precon page shows: enough to change the deck's shape, few enough to read. */
export const PRECON_SWAPS = 4;

/** WHAT A PRECON PAGE SHOWS (Precon mockup, 2026-09-27), computed once per static build from the
 *  deck's own report and written beside the card shards: the page reads this, never the engine,
 *  so a crawler and a reader see the same page. Card NAMES and the engine's own sentences only --
 *  no rules text (the site publishes its derivation, not the cards), and never a price. */
export interface PreconPage {
  slug: string;
  name: string;
  setCode: string;
  setName: string;
  releaseDate: string | null;
  commanders: string[];
  /** WUBRG letters. */
  identity: string[];
  theme: string | null;
  synergy: { score: number; band: string } | null;
  bracket: { band: "1-2" | "3" | "4-5"; gameChangers: number; combos: number } | null;
  /** Cards the commander works with, as the commander's map counts them. */
  commanderLinks: number;
  /** Synergy swaps, strongest first: both counts are the same measure (cards in the deck each works with). */
  swaps: { out: { name: string; connections: number }; in: PreconCard & { connections: number; reason: string | null } }[];
  /** The card that opens a route, when the report finds one. */
  route: (PreconCard & { reach: number; to: string }) | null;
  /** Role groups the deck is short in, for one line under the swaps. */
  gaps: { group: string; have: number; target: number }[];
  /** The list by type, lands last: names only. */
  decklist: { group: string; cards: { name: string; count: number }[] }[];
  /** The report's own link for this list (`/#deck=…`), when the list fits in one. */
  report?: string;
}
export interface PreconCard { name: string; slug: string; art?: string }

const TYPE_GROUP: Record<string, string> = {
  creature: "Creatures", planeswalker: "Planeswalkers", battle: "Battles",
  instant: "Instants and sorceries", sorcery: "Instants and sorceries",
  artifact: "Artifacts and enchantments", enchantment: "Artifacts and enchantments",
};
const GROUP_ORDER = ["Creatures", "Planeswalkers", "Battles", "Instants and sorceries", "Artifacts and enchantments", "Other", "Lands"];

const card = (c: SuggestedCard): PreconCard => ({ name: c.name, slug: c.slug, ...(c.art ? { art: c.art } : {}) });

/** The page, from the precon's report and the suggestions made for it. */
export function preconPage(meta: Pick<PreconPage, "slug" | "name" | "setCode" | "setName" | "releaseDate" | "commanders">,
  data: AnalyzeResponse, suggestions: DeckSuggestions | null): PreconPage {
  const report: DeckReport = data.report;
  const graph = data.graph;
  const model = graph ? buildEngineModel(report, graph) : null;
  const commanderId = graph?.nodes.find((n) => !n.face && !n.isToken && meta.commanders.includes(n.cardName ?? n.label))?.id;
  const orbit = model && commanderId ? buildOrbit(model, commanderId) : null;
  const theme = mainTheme(report);
  const nodes = new Map((graph?.nodes ?? []).filter((n) => !n.face && !n.isToken).map((n) => [n.cardName ?? n.label, n]));
  const byGroup = new Map<string, { name: string; count: number }[]>();
  for (const c of report.cards) {
    if (c.face || c.isCommander) continue;
    const name = c.cardName ?? c.name;
    const t = nodes.get(name)?.types ?? [];
    const group = t.some((x) => x.toLowerCase() === "land") ? "Lands" : TYPE_GROUP[primaryType(t) ?? ""] ?? "Other";
    const list = byGroup.get(group) ?? [];
    if (!list.some((x) => x.name === name)) list.push({ name, count: nodes.get(name)?.copies ?? 1 });
    byGroup.set(group, list);
  }
  const route = suggestions?.routes[0]?.route ? suggestions.routes[0] : null;
  return {
    ...meta,
    identity: data.commanderColorIdentity ?? [],
    theme: theme?.name ?? null,
    synergy: report.synergyOverall !== undefined ? { score: report.synergyOverall, band: scoreBand(report.synergyOverall).label } : null,
    bracket: report.bracket ? { band: report.bracket.band, gameChangers: report.bracket.gameChangers.length, combos: report.bracket.infiniteCombos } : null,
    commanderLinks: orbit ? orbit.direct : 0,
    swaps: (suggestions?.pairs ?? []).slice(0, PRECON_SWAPS).map((p) => ({
      out: { name: p.cut, connections: p.cutConnections },
      in: { ...card(p.add), connections: p.add.connections.length, reason: p.add.reasons[0]?.text ?? null },
    })),
    route: route?.route ? { ...card(route), reach: route.route.from.length, to: route.route.to } : null,
    gaps: findings(report).filter((f) => f.kind === "build" && f.shortfall > 0).map((f) => {
      const [have, target] = f.figure.split("/").map(Number);
      return { group: f.figureLabel, have: have ?? 0, target: target ?? 0 };
    }).filter((g) => g.target > g.have),
    decklist: GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, cards: byGroup.get(g)!.sort((a, b) => a.name.localeCompare(b.name)) })),
  };
}
