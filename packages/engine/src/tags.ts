import type { Card } from "./card.js";
import { PATTERNS } from "./patterns.js";

export type Tag = string;

export function tag(family: string, value?: string): Tag {
  return value === undefined ? family : `${family}:${value}`;
}

const BARE_LABELS: Record<string, string> = {
  "creature-etb": "creatures entering",
  "creature-death": "creatures dying",
  "sacrifice-fodder": "sacrifice fodder",
  "sacrifice-event": "sacrifice",
  "land-etb": "lands entering",
  "card-draw": "card draw",
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function describeTag(t: Tag): string {
  const sep = t.indexOf(":");
  const family = sep === -1 ? t : t.slice(0, sep);
  const value = sep === -1 ? undefined : t.slice(sep + 1);
  switch (family) {
    case "tribe":
      return `${capitalize(value ?? "")}s`;
    case "counter":
      return `${value} counters`;
    case "cast":
      return `${value}s`;
    case "token":
      return value ? `${value} tokens` : "tokens";
    default:
      return BARE_LABELS[family] ?? family.replace(/-/g, " ");
  }
}

export function text(card: Card): string {
  return card.oracleText.toLowerCase();
}

export function extractTags(card: Card): { produces: Set<Tag>; cares: Set<Tag> } {
  const produces = new Set<Tag>();
  const cares = new Set<Tag>();
  for (const p of PATTERNS) {
    if (p.matches(card)) {
      p.produces?.forEach((t) => produces.add(t));
      p.cares?.forEach((t) => cares.add(t));
    }
  }
  return { produces, cares };
}
