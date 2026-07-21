import type { MechanismCategory } from "../mechanisms.js";
import type { RawPair } from "./propose-pairs-core.js";

/** Category → EDHREC theme tag slug. Confirmed live (all 200) on 2026-07-21. The EDHREC `synergy`
 *  number is deck-inclusion lift (not CommanderSalt salt) — fine for candidate sourcing; a human
 *  verifies each pair before it counts. */
export const CATEGORY_EDHREC_TAG: Record<MechanismCategory, string> = {
  aristocrats: "aristocrats",
  "tokens-go-wide": "tokens",
  spellslinger: "spellslinger",
  reanimator: "reanimator",
  "voltron-auras": "auras",
  "lifegain-payoff": "lifegain",
  landfall: "landfall",
  "counters-plus1": "counters-matter",
  "mana-ramp-payoff": "ramp",
  "graveyard-matters": "graveyard",
  "attack-matters": "aggro",
  "blink-etb": "blink",
  "mill-self": "mill",
  "wheels-draw": "wheels",
};

export interface SynergyCard {
  name: string;
  slug: string;
  synergy: number;
}

/** The EDHREC tag-page JSON endpoint for a slug. */
export function tagUrl(slug: string): string {
  return `https://json.edhrec.com/pages/tags/${slug}.json`;
}

/** Extract the "High Synergy Cards" cardviews from an EDHREC tag payload. [] if absent. */
export function parseHighSynergy(payload: unknown): SynergyCard[] {
  const cardlists =
    (payload as { container?: { json_dict?: { cardlists?: unknown[] } } })?.container?.json_dict
      ?.cardlists ?? [];
  const list = (cardlists as Array<{ header?: string; cardviews?: unknown[] }>).find((g) =>
    (g.header ?? "").includes("High Synergy"),
  );
  const views = (list?.cardviews ?? []) as Array<{ name?: string; slug?: string; synergy?: number }>;
  return views
    .filter((cv): cv is SynergyCard => typeof cv.name === "string" && typeof cv.slug === "string")
    .map((cv) => ({ name: cv.name, slug: cv.slug, synergy: cv.synergy ?? 0 }));
}

/** Candidate pairs from a tag's top-K high-synergy cards: all unordered combinations. Human verifies. */
export function pairsFromCards(cards: SynergyCard[], topK: number, tagLabel: string): RawPair[] {
  const top = cards.slice(0, topK);
  const out: RawPair[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      out.push({ a: top[i].name, b: top[j].name, note: `co-high-synergy in EDHREC ${tagLabel}` });
    }
  }
  return out;
}
