import type { GameState, Marker } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { characteristicsSubject } from "./edges.js";
import { subjectMatches } from "./subject.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** GAME-STATE MARKERS, APPLIED TO THE DECK BEFORE ANY PAIR IS ASKED ABOUT (roadmap W18).
 *
 *  Speed is the PLAYER's (CR 702.179), one number for the deck, so everything here is a deck-level
 *  rewrite of the cards and `edges.ts` never sees a state: an ability whose `requires` the state
 *  does not meet is dropped (silent, exactly as an ability loss silences); an amount "where X is
 *  your speed" becomes the number; and every creature's power and toughness are read as the board
 *  would stand under the deck's anthems -- CR 613 layer 7c, additive statics only.
 *
 *  CEILINGS. 7b "base power and toughness" sets, counters and 7a CDAs are not applied. The anthems
 *  are summed as if every card were on the battlefield at once, the same assumption every edge
 *  already makes. Timestamps are not modelled, by owner ruling. */

const SPEED_X = /\bwhere x is your speed\b/i;

/** The value of a marker under the state; 0 when the state does not carry it. */
const markerValue = (state: GameState | undefined, marker: Marker): number =>
  marker === "speed" ? state?.speed ?? 0 : 0;

/** Silence and resolve: the card with the abilities the state allows, amounts resolved. Returns the
 *  same object when nothing changes, so a stateless run costs nothing here. */
export function applyState(inputs: DeckCard[], state: GameState | undefined): DeckCard[] {
  return inputs.map((dc) => {
    if (!dc.tags) return dc;
    let changed = false;
    const abilities = dc.tags.abilities.flatMap((a) => {
      if (a.requires && markerValue(state, a.requires.marker) < a.requires.min) { changed = true; return []; }
      if (a.amount && SPEED_X.test(a.amount) && state?.speed !== undefined) {
        changed = true;
        return [{ ...a, amount: a.amount.replace(/\bX\b/g, String(state.speed)).replace(/,\s*where \d+ is your speed/i, "") }];
      }
      return [a];
    });
    return changed ? { ...dc, tags: { ...dc.tags, abilities } } : dc;
  });
}

/** "+2/+2", "+X/+0", "-1/-1": the two halves of an anthem's amount, or nothing when it is not that
 *  shape (a count, a set, prose). An unresolved X reads as 0, the same rule the stat evaluator uses. */
export function parsePump(amount: string | undefined): { power: number; toughness: number } | undefined {
  const m = /^\s*([+-]?)(\d+|x)\s*\/\s*([+-]?)(\d+|x)/i.exec(amount ?? "");
  if (!m) return undefined;
  const n = (sign: string, v: string): number => (v.toLowerCase() === "x" ? 0 : Number(v)) * (sign === "-" ? -1 : 1);
  return { power: n(m[1]!, m[2]!), toughness: n(m[3]!, m[4]!) };
}

/** LAYER 7c: each creature's printed power and toughness plus every OTHER card's static pump whose
 *  subject reaches it. Written onto a fresh characteristics object -- the pool entries are the
 *  analysis's own copies, and the caller's inputs are never touched. */
export function applyAnthems(pool: DeckCard[], h: Hierarchy): void {
  const anthems = pool.flatMap((p) => (p.tags?.abilities ?? [])
    .filter((a) => a.kind === "static" && a.effect.kind === "pump" && a.effect.subject && a.effect.subject.self !== true)
    .map((a) => ({ from: p.card.name, subject: a.effect.subject!, amount: parsePump(a.amount) }))
    .filter((x): x is { from: string; subject: NonNullable<CardTags["abilities"][number]["effect"]["subject"]>; amount: { power: number; toughness: number } } => x.amount !== undefined));
  if (anthems.length === 0) return;
  for (const c of pool) {
    if (!c.tags || !c.tags.characteristics.types.includes("creature")) continue;
    const printed = { power: Number(c.tags.characteristics.power) || 0, toughness: Number(c.tags.characteristics.toughness) || 0 };
    let dp = 0, dt = 0;
    const self = characteristicsSubject(c.tags, c.card.name);
    for (const a of anthems) {
      if (a.from === c.card.name) continue;
      if (!subjectMatches(self, a.subject, h)) continue;
      dp += a.amount.power; dt += a.amount.toughness;
    }
    if (dp === 0 && dt === 0) continue;
    c.tags = { ...c.tags, characteristics: { ...c.tags.characteristics, power: String(printed.power + dp), toughness: String(printed.toughness + dt) } };
  }
}

/** Which markers the deck can reach at all: speed when any card prints Start your engines!. */
export function reachableMarkers(inputs: DeckCard[]): Marker[] {
  const speed = inputs.some((dc) => (dc.tags?.characteristics.keywords ?? []).some((k) => /start your engines/i.test(k)));
  return speed ? ["speed"] : [];
}
