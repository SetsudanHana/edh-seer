/** THE CRAFT COST (#1500, owner ruling 2026-11-06). Craft (CR 702.167a) "represents an activated ability. It is written as 'Craft with [materials] [cost],' ... It means '[Cost], Exile this permanent,
 *  Exile [materials] from among permanents you control and/or cards in your graveyard: Return this card to the battlefield transformed under its owner's control. Activate only as a sorcery.'"
 *  And 702.167b: a material described by a card type or subtype WITHOUT the word "card" is a permanent on the battlefield OR a card in a graveyard.
 *
 *  The store files the printed line as an inert `none` action ("Craft with creature {4}{B}"; Throne of the Grim Captain: `other`), so the exile that PAYS for it was never an event and
 *  Market Gnome ("exiled from the battlefield while you're activating a craft ability") had nothing to hear. This reads the line itself, from the segmenter's clause text, into the
 *  activated ability it means: a cost, and one exile of the materials from the battlefield and one from the graveyard where the words allow either. Each exile is then derived by the
 *  ordinary cost-exile path (Altar of Bhaal's "Exile a creature you control", Rust Harvester's "Exile an artifact card from your graveyard") and stamped `viaCraft` by the caller.
 *
 *  Not read, on purpose, so the line keeps deriving nothing rather than a guess:
 *  - a material this cannot name as a class ("four or more nonlands WITH ACTIVATED ABILITIES", The Enigma Jewel);
 *  CEILING: the craft card's OWN exile ("Exile this permanent") and the return of the card transformed are not events here; nothing hears either (no card asks for its own craft exile).
 *  CEILING: a count ("two creatures", "the four") is not carried: one exile per material class, as every other cost exile is. */
import type { Action } from "../canonicalize.js";

export interface CraftReading {
  /** The activation cost in CR 702.167a's own words, for `paymentOf`. */
  cost: string;
  /** One exile per material class and zone. */
  actions: Action[];
}

/** The text the rewritten clause reads as its effect: the return is CR 702.167a's, and "Activate only as a sorcery" is what makes the derive stamp the ability sorcery speed. */
export const CRAFT_EFFECT_TEXT = "Return this card to the battlefield transformed under its owner's control. Activate only as a sorcery.";

const PREFIX = "craft with ";
const COUNTS: ReadonlySet<string> = new Set(["a", "an", "one", "two", "three", "four", "five", "six", "seven", "another", "other"]);

/** True when the clause text is a printed craft line. */
export function isCraftLine(text: string | undefined): boolean {
  return text !== undefined && text.slice(0, PREFIX.length).toLowerCase() === PREFIX;
}

/** Splits "<materials> {4}{B}" into the materials and the trailing run of mana symbols; null when there is no cost. */
function splitCost(rest: string): { materials: string; mana: string } | null {
  const t = rest.trim();
  let end = t.length;
  while (end > 0 && t[end - 1] === "}") {
    const open = t.lastIndexOf("{", end - 1);
    if (open < 0) return null;
    end = open;
  }
  if (end === t.length) return null;
  return { materials: t.slice(0, end).trim(), mana: t.slice(end) };
}

/** One material ("a Dinosaur", "two creatures", "one or more", "artifact") as the class the exile names: `null` = a class this cannot read. */
function materialOf(part: string): { noun: string; battlefield: boolean; graveyard: boolean } | null {
  const w = part.trim().toLowerCase().split(" ").filter((x) => x !== "");
  let i = 0;
  if (w[0] !== undefined && COUNTS.has(w[0])) {
    i = 1;
    if (w[1] === "or" && w[2] === "more") i = 3;
  }
  const head = w.slice(i);
  // "one or more" / "two that share a card type" name no class: any permanent, or any card in a graveyard.
  if (head.length === 0 || head[0] === "that") return { noun: "", battlefield: true, graveyard: true };
  if (head.includes("with")) return null;
  const last = head[head.length - 1]!;
  // "cards" is the graveyard's word (702.167b): an instant or sorcery is never a permanent.
  const cards = last === "cards" || last === "card";
  const nouns = cards ? head.slice(0, -1) : head;
  if (nouns.length === 0) return { noun: "", battlefield: !cards, graveyard: true };
  const tail = nouns[nouns.length - 1]!;
  const singular = tail.endsWith("s") && !tail.endsWith("ss") ? tail.slice(0, -1) : tail;
  return { noun: [...nouns.slice(0, -1), singular].join(" "), battlefield: !cards, graveyard: true };
}

/** The craft ability a printed craft line means, or null when the materials are not a class this can name. */
export function craftOf(text: string): CraftReading | null {
  if (!isCraftLine(text)) return null;
  const split = splitCost(text.slice(PREFIX.length));
  if (!split) return null;
  const materials = split.materials.split(", ").map((p) => (p.startsWith("and ") ? p.slice(4) : p)).map(materialOf);
  if (materials.length === 0 || materials.some((m) => m === null)) return null;
  const actions: Action[] = [];
  for (const m of materials as { noun: string; battlefield: boolean; graveyard: boolean }[]) {
    if (m.battlefield) actions.push({ verb: "exile", object: m.noun === "" ? "a permanent you control" : `a ${m.noun} you control`, fromZone: "battlefield", toZone: "exile", amount: null, optional: false } as Action);
    if (m.graveyard) actions.push({ verb: "exile", object: m.noun === "" ? "a card from your graveyard" : `a ${m.noun} card from your graveyard`, fromZone: "graveyard", toZone: "exile", amount: null, optional: false } as Action);
  }
  if (actions.length === 0) return null;
  return { cost: `${split.mana}, Exile this permanent, Exile ${split.materials} from among permanents you control and/or cards in your graveyard`, actions };
}
