import { eventKeyAction, eventKeyClause } from "./demand-sentence.js";
import { groupDirection } from "./inject.js";
import type { EngineCard } from "./engine-model.js";
import type { OrbitModel, OrbitPartner, OrbitSector } from "./orbit-model.js";
import type { CardPageData, PartnerRow } from "./partners.js";
import { printingImageUrl } from "../components/card-node.js";

/** A CARD PAGE AS A MAP (owner, 2026-09-27: "including graph on /cards and /commander pages"). The
 *  report's map reads a deck's engine model; a card page has no deck, only the page's partner rows,
 *  grouped by the event they share. This turns those rows into the same shape: the page's card in
 *  the middle, each event a group with its own colour, and each link running from the card that
 *  causes the event to the card that waits for it (`PartnerRow.producer`). Nothing here is read
 *  twice: the rows are the list below the map, drawn. */

/** One colour per event, in the page's order. The report's theme colours, then round again. */
const HUES = ["#1c8db7", "#c0703a", "#21a28f", "#b5577a", "#9a6bc0", "#8a8f3a", "#6b89f9", "#b08e1d", "#4f7fa0", "#277310", "#5b40f6"];
export const hueOf = (i: number) => HUES[i % HUES.length]!;

function cardOf(slug: string, name: string, art: string | undefined, typeLine = ""): EngineCard {
  return {
    id: slug, name, typeLine, text: "", physical: name, manaCost: "", roles: [], score: 0,
    isToken: false, isCommander: false, isLand: false, isFace: false,
    ...(art ? { image: printingImageUrl(art) ?? undefined } : {}),
  };
}

export interface PageMap {
  cards: Map<string, EngineCard>;
  orbit: OrbitModel;
  /** The event groups in the page's order, with their colours: the key the list below shows. */
  groups: { event: string; name: string; hue: string }[];
}

/** The page's map. `rows` are the partners to draw (the page's own list, or a commander's). */
export function pageMap(page: CardPageData, slug: string, rows: readonly PartnerRow[] = page.partners): PageMap {
  const focus = cardOf(slug, page.name, undefined, page.typeLine);
  focus.image = page.artCrop ? cardImage(page.artCrop) : undefined;
  const cards = new Map<string, EngineCard>([[slug, focus]]);
  const sectors: OrbitSector[] = [];
  const groups: PageMap["groups"] = [];
  for (const row of rows) {
    if (row.slug === slug) continue;
    let s = sectors.find((x) => x.key === row.event);
    if (!s) {
      const same = rows.filter((r) => r.event === row.event);
      const name = groupDirection(same) === "asks" ? eventKeyClause(row.event) : eventKeyAction(row.event) ?? eventKeyClause(row.event);
      s = { key: row.event, name, hue: hueOf(sectors.length), partners: [] };
      sectors.push(s);
      groups.push({ event: row.event, name, hue: s.hue });
    }
    const card = cards.get(row.slug) ?? cardOf(row.slug, row.name, row.art);
    cards.set(row.slug, card);
    const link = { from: row.producer ? row.slug : slug, to: row.producer ? slug : row.slug, tag: row.event, text: row.reason, repeat: "triggered" as const };
    const had = s.partners.find((p) => p.card.id === row.slug);
    if (had) had.links.push(link);
    else s.partners.push({ card, links: [link], once: false });
  }
  const direct = new Set(sectors.flatMap((s) => s.partners.map((p) => p.card.id))).size;
  const orbit = { focus, sectors, direct, directTokens: 0, near: [], through: [], far: [], farLands: 0 } as unknown as OrbitModel;
  return { cards, orbit, groups };
}

/** THE MAP DRAWS A FEW OF EVERY GROUP, NOT ALL OF THE FIRST ONE. The rows come most specific
 *  first, three to an event, so the first fourteen would be the first five events; taking the
 *  first of each event, then the second, spreads the map over what the page says. */
export function pickRoundRobin(o: OrbitModel, cap: number): { p: OrbitPartner; hue: string }[] {
  const out: { p: OrbitPartner; hue: string }[] = [];
  const seen = new Set<string>();
  for (let round = 0; out.length < cap; round++) {
    let any = false;
    for (const s of o.sectors) {
      const p = s.partners[round];
      if (!p) continue;
      any = true;
      if (seen.has(p.card.id)) continue;
      seen.add(p.card.id);
      out.push({ p, hue: s.hue });
      if (out.length >= cap) break;
    }
    if (!any) break;
  }
  return out;
}

/** The page's card, whole: an art crop would owe the artist a credit this corpus cannot give (see
 *  `CardPageRecord.artCrop`), and the full card prints it. */
function cardImage(artCrop: string): string | undefined {
  return artCrop.replace(/\/art_crop\//, "/small/");
}
