import { useEffect, useMemo, useState } from "react";
import { idsOf, linksWithin } from "../lib/deck-sky.js";
import type { EngineModel } from "../lib/engine-model.js";
import type { FirstTurns } from "../lib/first-turns.js";
import { DeckSky, type SkyLight } from "./DeckSky.js";
import { useReducedMotion } from "./OrbitView.js";

/** THE FIRST TURNS ON THE DECK'S SKY (owner, 2026-09-27: the sky in every chapter). Turn by turn,
 *  the cards whose cost the deck's typical mana reaches light up, and so do the links between them:
 *  the engine assembling itself, drawn. The same figures as the turn list above it (`firstTurns`),
 *  counted cumulatively, since a card castable on turn 2 is still castable on turn 4.
 *
 *  PLAY RUNS TURN 1 TO 5 ONCE, on request: nothing moves on its own, and with reduced motion the
 *  turns are only stepped. */
export function TurnSky({ model, turns }: { model: EngineModel; turns: FirstTurns }) {
  const last = turns.steps.length;
  const [turn, setTurn] = useState(Math.min(3, last));
  const [playing, setPlaying] = useState(false);
  const still = useReducedMotion();
  useEffect(() => {
    if (!playing) return;
    if (turn >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setTurn((x) => x + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, turn, last]);

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
    // THE TURN LIST'S OWN COUNT, AND ITS OWN CAVEAT (persona round, 2026-09-27: "by turn 5, 56" over
    // the list and "57 castable" under the sky, and three quarters of the sky lit read as "the deck
    // is online"). Spells are counted as the list counts them; the commander is named apart; and
    // the sky says what "castable" means here.
    return {
      ids, lines,
      label: `Turn ${turn}${step ? `, with ${step.mana} mana in a typical game` : ""}: ${n} spell${n === 1 ? "" : "s"} cheap enough to cast by now${commander.length ? ", and your commander" : ""}, lit (by cost, not by what is in your hand), and ${lines.length ? `the ${lines.length} link${lines.length === 1 ? "" : "s"} this turn adds between them, in pink` : turn === 1 ? "no links between them yet" : "no new links between them this turn"}.`,
    };
  }, [model, turns, turn]);

  if (!last) return null;
  const btn = "min-h-9 min-w-9 rounded-(--radius) border px-2 text-sm";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Turn shown on the sky">
        {turns.steps.map((s) => (
          <button key={s.turn} type="button" aria-pressed={s.turn === turn} onClick={() => { setPlaying(false); setTurn(s.turn); }}
            className={`${btn} ${s.turn === turn ? "border-(--accent) text-(--accent)" : "border-(--separator) hover:border-(--foreground)"}`}>
            T{s.turn}
          </button>
        ))}
        {still ? null : (
          <button type="button" className={`${btn} ml-1 border-(--separator) hover:border-(--foreground)`}
            onClick={() => { if (playing) setPlaying(false); else { setTurn(1); setPlaying(true); } }}>
            {playing ? "Stop" : "Play turns 1 to " + last}
          </button>
        )}
      </div>
      <DeckSky model={model} lit={light} className="w-full max-w-[28rem]" />
    </div>
  );
}
