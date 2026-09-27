import { useMemo } from "react";
import { idsOf, linksWithin } from "../lib/deck-sky.js";
import type { EngineModel } from "../lib/engine-model.js";
import type { FirstTurns } from "../lib/first-turns.js";
import { DeckSky, type SkyLight } from "./DeckSky.js";

/** THE FIRST TURNS ON THE DECK'S SKY (owner, 2026-09-27: the sky in every chapter). On the turn
 *  picked, the cards whose cost the deck's typical mana reaches light up, and so do the links this
 *  turn adds between them: the engine assembling itself, drawn. The same figures as the turn tiles
 *  beside it (`firstTurns`), counted cumulatively, since a card castable on turn 2 is still castable
 *  on turn 4. `FirstTurns` owns the turn picked; this only draws it. */
export function TurnSky({ model, turns, turn }: { model: EngineModel; turns: FirstTurns; turn: number }) {
  const light = useMemo((): SkyLight => {
    const names = turns.steps.filter((s) => s.turn <= turn).flatMap((s) => s.jobs.flatMap((j) => j.cards.map((c) => c.name)));
    const commander = turns.commander && (turns.commander.turn ?? Infinity) <= turn ? [turns.commander.name] : [];
    const spells = idsOf(model, names);
    const ids = new Set([...spells, ...idsOf(model, commander)]);
    // ONLY THE LINKS THIS TURN ADDS (persona round, 2026-09-27: 126 and 281 lines by turns 3 and 5
    // were a hairball nobody could read). The cards castable by the turn before are the baseline.
    const before = idsOf(model, [
      ...turns.steps.filter((s) => s.turn < turn).flatMap((s) => s.jobs.flatMap((j) => j.cards.map((c) => c.name))),
      ...(turns.commander && (turns.commander.turn ?? Infinity) < turn ? [turns.commander.name] : []),
    ]);
    const old = new Set(linksWithin(model, before).map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
    const lines = linksWithin(model, ids).filter(([a, b]) => !old.has(a < b ? `${a}|${b}` : `${b}|${a}`));
    const step = turns.steps.find((s) => s.turn === turn);
    const n = step?.castable ?? spells.size;
    // THE TURN TILES' OWN COUNT (persona round, 2026-09-27: two different counts for one turn read
    // as a bug). Spells are counted as the tiles count them; the commander is named apart. What
    // "castable" means is said once, under the tiles, not again here.
    return {
      ids, lines,
      label: `Turn ${turn}: ${n} spell${n === 1 ? "" : "s"} castable${commander.length ? " and your commander" : ""}, lit${lines.length ? `; the ${lines.length} link${lines.length === 1 ? "" : "s"} this turn adds, in pink` : ""}.`,
    };
  }, [model, turns, turn]);

  if (!turns.steps.length) return null;
  return <DeckSky model={model} lit={light} className="w-full max-w-[28rem]" />;
}
