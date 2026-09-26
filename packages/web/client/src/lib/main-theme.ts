import type { DeckReport } from "../types.js";
import type { EngineGroup } from "./engine-model.js";

/** THE DECK'S MAIN THEME, ONE NAME ON EVERY CHAPTER (appeal review 2026-09-26). Three vocabularies
 *  named the same deck: Glance said "Cleric typal", Game plan said "Counts your party members", and
 *  the Archetypes bars said "Tokens 22%" -- with 15, 32 and 47% beside them. Four seats of five
 *  stopped on it.
 *
 *  The main theme is the engine's `cohesion`: the tag most of the deck's own cards are about, named
 *  by `themeName`. Game plan's themes are groups of LINKS keyed by the same `verb:subject` tag
 *  vocabulary, so the two meet on the tag. A group with the main theme's own tag IS the main theme
 *  and takes its name; a group about the same subject ("Counts your Clerics" beside "Cleric typal")
 *  is part of it. Where no group meets it, the page says so rather than showing two unrelated
 *  names. */
export interface MainTheme {
  name: string;
  tag: string;
  /** Nonland cards whose own text is about the theme (the commander included). */
  count: number;
  nonland: number;
  /** The runner-up theme from another family ("also cares about Enchantress"), matched the same way. */
  second?: { name: string; tag: string };
}

export function mainTheme(report: DeckReport): MainTheme | null {
  const c = report.cohesion;
  if (!c || c.dominant === false) return null;
  const second = c.secondaryTag && (c.secondaryName ?? c.secondary)
    ? { name: (c.secondaryName ?? c.secondary)!, tag: c.secondaryTag } : undefined;
  return { name: c.name, tag: c.tag, count: c.onThemeCount, nonland: c.nonlandCount, ...(second ? { second } : {}) };
}

/** Subjects too broad to join two themes on: "creatures entering" is not part of "Cleric typal". */
const BROAD = new Set(["creature", "creatures", "permanent", "permanents", "any", "nontoken", "card", "spell"]);

const subject = (tag: string): string | null => {
  const i = tag.indexOf(":");
  return i < 0 ? null : tag.slice(i + 1).toLowerCase();
};

/** "same" when the group is the theme's own tag, "part" when it is about the same subject. */
export function themeMatch(group: Pick<EngineGroup, "tag" | "helper">, main: Pick<MainTheme, "tag">): "same" | "part" | null {
  if (group.helper) return null;
  if (group.tag === main.tag) return "same";
  const a = subject(group.tag), b = subject(main.tag);
  if (!a || !b || BROAD.has(a) || BROAD.has(b)) return null;
  return a === b ? "part" : null;
}

/** Which of the deck's two named themes a group is, if either: the main one first. */
export function whichTheme(group: Pick<EngineGroup, "tag" | "helper">, main: MainTheme):
  { theme: "main" | "second"; name: string; match: "same" | "part" } | null {
  const m = themeMatch(group, main);
  if (m) return { theme: "main", name: main.name, match: m };
  const s = main.second ? themeMatch(group, main.second) : null;
  return s ? { theme: "second", name: main.second!.name, match: s } : null;
}
