import type { Card } from "./card.js";
import { PATTERNS } from "./patterns.js";
import { toCardView, type CardView } from "./cardview.js";

export type Tag = string;

export function tag(family: string, value?: string): Tag {
  return value === undefined ? family : `${family}:${value}`;
}

const BARE_LABELS: Record<string, string> = {
  "creature-etb": "creatures entering",
  "nontoken-etb": "a nontoken creature entering",
  "creature-death": "creatures dying",
  "sacrifice-fodder": "sacrifice fodder",
  "sacrifice-event": "sacrifice",
  "land-etb": "lands entering",
  "card-draw": "card draw",
  "graveyard": "the graveyard",
  "lifegain": "life gain",
  "blink": "blink/flicker",
  "enchantment": "enchantments",
  "aura": "auras",
  "equipment": "equipment",
  "attack-trigger": "attack triggers",
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** The mechanism half of a tag: everything before the first ":". Tags are `<verb>:<subject>`.
 *  For most verbs the segment after the colon is a KIND axis (`tribe:wizard` vs `tribe:goblin`,
 *  `static:pump` vs `static:cost-reduction`) — different subjects there are different themes and
 *  must never be summed together. `:any` is the one subject value that is a GRANULARITY, not a
 *  kind: it names the general form of the same mechanism, so `counter-added:any` subsumes
 *  `counter-added:creature` rather than a different counter theme. Use this to ask "same
 *  mechanism?" (as describeTag does below); it is not a safe grouping key for summing deck
 *  frequency across subjects — see rankThemes in weights.ts, which only folds the literal
 *  `:any` sibling, not the whole family. */
export function tagFamily(tag: Tag): string {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(0, i);
}

export function describeTag(t: Tag): string {
  const family = tagFamily(t);
  const value = family === t ? undefined : t.slice(family.length + 1);
  switch (family) {
    case "tribe":
      return `${capitalize(value ?? "")}s`;
    case "tribe-nontoken":
      return `nontoken ${capitalize(value ?? "")}s`;
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

function resolveTags(
  spec: Tag[] | ((view: CardView) => Tag[]) | undefined,
  view: CardView,
): Tag[] {
  if (!spec) return [];
  return typeof spec === "function" ? spec(view) : spec;
}

export function extractTags(card: Card): { produces: Set<Tag>; cares: Set<Tag> } {
  const view = toCardView(card);
  const produces = new Set<Tag>();
  const cares = new Set<Tag>();
  for (const p of PATTERNS) {
    if (p.matches(view)) {
      for (const t of resolveTags(p.produces, view)) produces.add(t);
      for (const t of resolveTags(p.cares, view)) cares.add(t);
    }
  }
  return { produces, cares };
}
