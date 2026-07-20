import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Hierarchy } from "./types.js";

const CARD_TYPES = [
  "creature", "artifact", "enchantment", "instant", "sorcery",
  "planeswalker", "land", "battle", "tribal", "kindred",
];

/** Parse "Legendary Creature — Human Wizard" into { wizard:["creature"], human:["creature"] }.
 *  The part after the em dash lists subtypes; the part before lists card types they belong to. */
export function buildHierarchy(typeLines: string[]): Hierarchy {
  const h: Hierarchy = {};
  for (const line of typeLines) {
    const [left, right] = line.split(/\s[—–-]\s/); // em dash, en dash, or hyphen with spaces
    if (!right) continue;
    const types = left.toLowerCase().split(/\s+/).filter((w) => CARD_TYPES.includes(w));
    if (types.length === 0) continue;
    for (const sub of right.toLowerCase().split(/\s+/).filter(Boolean)) {
      const set = new Set(h[sub] ?? []);
      for (const t of types) set.add(t);
      h[sub] = [...set];
    }
  }
  return h;
}

/** True iff `subtype` is a recorded member of card type `type` (both matched case-insensitively). */
export function impliesType(h: Hierarchy, subtype: string, type: string): boolean {
  return (h[subtype.toLowerCase()] ?? []).includes(type.toLowerCase());
}

/** Load the bundled hierarchy.json produced by `gen-hierarchy`. */
export function loadHierarchy(): Hierarchy {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "hierarchy.json");
  return JSON.parse(readFileSync(path, "utf8")) as Hierarchy;
}
