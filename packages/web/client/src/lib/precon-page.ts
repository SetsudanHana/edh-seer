import type { DeckSuggestions, SuggestedCard } from "@edh-seer/matcher/suggest-static";
import type { BracketTarget, UpgradePackage } from "@edh-seer/matcher/upgrade-package";
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
  /** The report's Build score (consistency), with its band word; absent on a page built before it was recorded. */
  build?: { score: number; band: string } | null;
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
  /** CARDS THE PAGE NAMES THAT HAVE NO CARD PAGE (#1003 review: Godless Shrine, Plains, Command
   *  Tower 404'd). A card page exists only for a substantive card (`isSubstantive`), so a shock land
   *  or a basic is named here as text, never as a link to a 404. Written by `build-precons.mts`. */
  unpaged?: string[];
  /** The report's own link for this list (`/#deck=…`), when the list fits in one. */
  report?: string;
  /** THE UPGRADE PACKAGE FOR EACH BRACKET TARGET (#767): bring-down cuts first when the precon starts
   *  above the target, then role sections of paired swaps, a reason on both sides. Absent on a page
   *  built before packages existed. */
  packages?: UpgradePackage[];
  /** Targets no cut can reach: the page says so instead of offering a package. */
  unreachable?: BracketTarget[];
  /** Slug and art for every card a package adds, by name. */
  packageCards?: Record<string, PreconCard>;
}
/** THE ROLE GROUPS A REPORT IS SHORT IN, against a typical Commander deck. One rule for the precon
 *  as printed and for each package's swapped deck, so "short before" and "short after" are the same
 *  measure (#893). */
export function gapsOf(report: DeckReport): { group: string; have: number; target: number }[] {
  return findings(report).filter((f) => f.kind === "build" && f.shortfall > 0).map((f) => {
    const [have, target] = f.figure.split("/").map(Number);
    return { group: f.figureLabel, have: have ?? 0, target: target ?? 0 };
  }).filter((g) => g.target > g.have);
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
  // BY THE WHOLE NAME OR ITS FRONT FACE: MTGJSON names a meld card with its partner
  // ("Gisela, the Broken Blade // Brisela, Voice of Nightmares"), the deck by the card it prints.
  const wanted = new Set(meta.commanders.flatMap((c) => [c, c.split(" // ")[0]!]));
  const commanderId = graph?.nodes.find((n) => !n.face && !n.isToken && (wanted.has(n.cardName ?? n.label) || wanted.has(n.label)))?.id;
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
    gaps: gapsOf(report),
    build: report.buildScore !== undefined ? { score: report.buildScore, band: scoreBand(report.buildScore, "build").label } : null,
    decklist: GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, cards: byGroup.get(g)!.sort((a, b) => a.name.localeCompare(b.name)) })),
  };
}
