import type { CutChoice } from "./cut-choice.js";
import type { EngineModel } from "./engine-model.js";

/** CUTS READ AS A SET, NOT ONE AT A TIME (#1153). A link is lost when every card that also gives it
 *  is cut too, so "cutting it loses nothing" is only true of a cut list when it is read against the
 *  whole list. Pure, so the component only chooses where to apply it. */

/** Token name -> the physical names of the cards that make it. `by` names a token by its own name,
 *  which no cut list holds, so a token cover is gone when every one of its makers is cut. */
export function tokenMakersOf(model: EngineModel | null | undefined): Map<string, readonly string[]> {
  const makers = new Map<string, readonly string[]>();
  if (!model) return makers;
  // madeBy holds FACE names; the cut list holds physical ones ("Front // Back").
  const physicalOf = new Map<string, string>();
  for (const c of model.cards.values()) if (!c.isToken) physicalOf.set(c.name, c.physical);
  for (const t of model.cards.values()) if (t.isToken && t.madeBy?.length) makers.set(t.physical, t.madeBy.map((m) => physicalOf.get(m) ?? m));
  return makers;
}

type Makers = ReadonlyMap<string, readonly string[]>;

/** True when `n` is cut: named in `set`, or a token whose every maker is. */
export const cutIn = (n: string, set: ReadonlySet<string>, makers: Makers): boolean =>
  set.has(n) || (makers.get(n)?.every((m) => set.has(m)) ?? false);

/** What cutting `c` loses when `set` is cut too (`set` should hold `c`): its own losses, then the
 *  links whose every other giver is in `set`. Undefined for a card the graph has no row for. */
export function lossIn(c: CutChoice, set: ReadonlySet<string>, makers: Makers): string[] | undefined {
  const s = lossSplit(c, set, makers);
  return s ? [...s.own, ...s.together] : undefined;
}

/** The same loss, told apart: `own` is lost cutting the card alone, `together` only because other
 *  cards in `set` go too, and `by` is which of them (a token's makers stand for the token). */
export function lossSplit(c: CutChoice, set: ReadonlySet<string>, makers: Makers): { own: string[]; together: string[]; by: string[] } | undefined {
  if (!c.row) return undefined;
  const lost = c.row.covers.filter((x) => x.by.every((n) => cutIn(n, set, makers)));
  const by = new Set<string>();
  for (const x of lost) for (const n of x.by) for (const m of set.has(n) ? [n] : makers.get(n) ?? []) if (m !== c.name && set.has(m)) by.add(m);
  return { own: c.row.loses.map((l) => l.text), together: lost.map((x) => x.link.text), by: [...by] };
}

/** PICKED ONE AT A TIME (review): a card joins only while every picked card still loses nothing
 *  with the whole set cut, so two cards that cover each other never both go. A card that loses
 *  something on its own is never picked. Stops at `limit` (Infinity for no cap). */
export function pickTogether(ordered: readonly CutChoice[], limit: number, makers: Makers): Set<string> {
  const chosen = new Set<string>();
  for (const c of ordered) {
    if (chosen.size >= limit) break;
    if (c.row?.loses.length) continue;
    const trial = new Set([...chosen, c.name]);
    if (ordered.filter((x) => trial.has(x.name)).every((x) => !lossIn(x, trial, makers)?.length)) chosen.add(c.name);
  }
  return chosen;
}
