import { useEffect, useState } from "react";
import { FIRST_TURNS, JOB_LABEL, type FirstTurns as Model, type TurnStep } from "../lib/first-turns.js";
import { CardName } from "./card-drawer.js";
import { useReducedMotion } from "./OrbitView.js";

/** Names shown per job before "+N": enough to see what the turn is for. */
const NAMED = 6;

/** THE FIRST FIVE TURNS, AS FIVE TILES AND ONE TURN AT A TIME (owner, 2026-09-27: "Your first 5
 *  turns is wall of text, no one is going to read it"). Five turns of card lists, one under the
 *  other, were 770px of names. The tiles give the shape at a glance: the mana each turn, how many
 *  spells it opens up, the turn the commander lands. The cards are read for the one turn picked. See `lib/first-turns.ts` for what every number counts. */
export function FirstTurns({ model }: { model: Model }) {
  const { steps, nonland, commander } = model;
  const last = steps.length;
  const [turn, setTurn] = useState(Math.min(3, last));
  const [playing, setPlaying] = useState(false);
  const still = useReducedMotion();
  useEffect(() => {
    if (!playing) return;
    if (turn >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setTurn((x) => x + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, turn, last]);
  if (!last) return null;
  const third = steps.find((s) => s.turn === 3);
  const lastStep = steps.at(-1)!;
  const step = steps.find((s) => s.turn === turn) ?? steps[0]!;
  return (
    <div className="flex flex-col gap-3" data-testid="first-turns">
      <h3 className="eyebrow text-(--foreground)">Your first {FIRST_TURNS} turns</h3>
      <p className="text-sm max-w-[65ch]" data-testid="first-turns-headline">
        {third ? <>By turn 3 you can cast <b>{third.castable} of your {nonland} spells</b>, and by turn {lastStep.turn}, {lastStep.castable}.</> : null}
        {commander?.turn !== undefined
          ? <> Your commander, <CardName name={commander.name} /> ({commander.manaValue} mana), comes down on <b>turn {commander.turn}</b> in half your games.</>
          : commander ? <> Your commander, <CardName name={commander.name} />, costs {commander.manaValue}: more than the deck typically has by turn 8.</> : null}
      </p>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Pick a turn">
          {steps.map((s) => (
            <Tile key={s.turn} step={s} on={s.turn === turn} commander={commander?.turn === s.turn}
              pick={() => { setPlaying(false); setTurn(s.turn); }} />
          ))}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-(--muted)">Typical mana each turn; a spell counts once its cost fits, whether or not it is in your hand.</p>
          {still || last < 2 ? null : (
            <button type="button" className="text-xs text-(--accent) underline underline-offset-2 py-1"
              onClick={() => { if (playing) setPlaying(false); else { setTurn(1); setPlaying(true); } }}>
              {playing ? "Stop" : `Play turns 1 to ${last}`}
            </button>
          )}
        </div>
      </div>
      <TurnCards step={step} commanderHere={commander?.turn === step.turn ? commander.name : undefined} />
    </div>
  );
}

function Tile({ step, on, commander, pick }: { step: TurnStep; on: boolean; commander: boolean; pick: () => void }) {
  const fresh = step.jobs.reduce((n, j) => n + j.cards.length, 0);
  return (
    <button type="button" aria-pressed={on} onClick={pick} data-testid="first-turn-tile"
      aria-label={`Turn ${step.turn}: ${step.mana} mana, ${fresh} new spell${fresh === 1 ? "" : "s"}${commander ? ", commander" : ""}`}
      className={`flex flex-col items-center gap-0.5 rounded-(--radius) border px-1 py-2 text-center ${on ? "border-(--accent) bg-(--surface-secondary)" : "border-(--separator) hover:border-(--foreground)"}`}>
      <span className={`text-xs ${on ? "text-(--accent)" : "text-(--muted)"}`}>Turn {step.turn}</span>
      <span className="stat-num text-xl leading-none">{step.mana}</span>
      <span className="text-[11px] text-(--muted)">mana</span>
      <span className="text-[11px] stat-num">{fresh ? `+${fresh} spells` : "no new"}</span>
      {/* ON THE PICKED TILE'S TINT THE ACCENT FAILS CONTRAST (axe, persona round 2026-09-29), so the
        *  picked tile says it in the foreground; the border already carries the accent. */}
      {commander ? <span className={`text-[11px] ${on ? "text-(--foreground)" : "text-(--accent)"}`}>commander</span> : null}
    </button>
  );
}

/** The one turn picked: what it opens up, by job. */
function TurnCards({ step, commanderHere }: { step: TurnStep; commanderHere?: string }) {
  const spread = step.low !== step.mana || step.high !== step.mana
    ? `${step.low === step.high ? step.low : `${step.low}–${step.high}`} in slow to fast games` : "";
  return (
    <div className="flex flex-col gap-2" data-testid="first-turn">
      <p className="text-sm">
        <b>Turn {step.turn}</b> · {step.mana} mana{spread ? <span className="text-xs text-(--muted)"> ({spread})</span> : null}
        {commanderHere ? <> · your commander, <CardName name={commanderHere} /></> : null}
      </p>
      {step.jobs.length ? (
        <ul className="flex flex-col gap-2">
          {step.jobs.map((g) => <Job key={`${step.turn}-${g.job}`} label={JOB_LABEL[g.job]} cards={g.cards.map((c) => c.name)} />)}
        </ul>
      ) : (
        <p className="text-sm text-(--muted)">Nothing new costs {step.mana}: the turn goes to what is already castable.</p>
      )}
    </div>
  );
}

function Job({ label, cards }: { label: string; cards: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, NAMED);
  return (
    <li className="flex flex-col gap-1" data-testid="first-turn-job">
      <span className="eyebrow text-(--muted)">{label} · {cards.length}</span>
      <span className="flex flex-wrap gap-1">
        {shown.map((n) => (
          <span key={n} className="inline-flex min-h-9 items-center rounded-(--radius) border border-(--separator) px-2.5 text-sm"><CardName name={n} /></span>
        ))}
        {cards.length > NAMED ? (
          <button type="button" className="rounded-full px-2 py-0.5 text-xs text-(--accent) underline underline-offset-2" onClick={() => setAll(!all)}>
            {all ? "fewer" : `+${cards.length - NAMED} more`}
          </button>
        ) : null}
      </span>
    </li>
  );
}
