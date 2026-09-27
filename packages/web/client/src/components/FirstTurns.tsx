import { useState } from "react";
import { FIRST_TURNS, JOB_LABEL, type FirstTurns as Model, type TurnStep } from "../lib/first-turns.js";
import { CardName } from "./card-drawer.js";

/** Names shown per job before "+N": enough to see what the turn is for. */
const NAMED = 4;

/** THE FIRST FIVE TURNS, ONE ROW EACH. See `lib/first-turns.ts` for what every number counts. */
export function FirstTurns({ model }: { model: Model }) {
  const { steps, nonland, commander } = model;
  if (!steps.length) return null;
  const third = steps.find((s) => s.turn === 3);
  const last = steps.at(-1)!;
  return (
    <div className="flex flex-col gap-3 max-w-4xl" data-testid="first-turns">
      <h3 className="eyebrow text-(--foreground)">Your first {FIRST_TURNS} turns</h3>
      <p className="text-sm max-w-[65ch]" data-testid="first-turns-headline">
        {third ? <>By turn 3 you can cast <b>{third.castable} of your {nonland} spells</b>, and by turn {last.turn}, {last.castable}.</> : null}
        {commander?.turn !== undefined
          ? <> Your commander, <CardName name={commander.name} /> ({commander.manaValue} mana), comes down on <b>turn {commander.turn}</b> in half your games.</>
          : commander ? <> Your commander, <CardName name={commander.name} />, costs {commander.manaValue}: more than the deck typically has by turn 8.</> : null}
      </p>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => <Turn key={s.turn} step={s} commanderHere={commander?.turn === s.turn ? commander.name : undefined} />)}
      </ol>
      <p className="text-xs text-(--muted) max-w-[65ch]">
        The mana is the simulated deck&rsquo;s typical game. A card is listed on the first turn its cost
        fits that mana; whether it is in your hand, and its colours, are not counted. Each card is
        listed under one job: ramp first, then card draw, then the win plans, then interaction.
      </p>
    </div>
  );
}

function Turn({ step, commanderHere }: { step: TurnStep; commanderHere?: string }) {
  const spread = step.low !== step.mana || step.high !== step.mana
    ? `${step.low === step.high ? step.low : `${step.low}–${step.high}`} in slow to fast games`
    : "";
  return (
    <li className="rounded-lg border border-(--separator) px-3 py-2 flex flex-col gap-1" data-testid="first-turn">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm"><b>Turn {step.turn}</b> · {step.mana} mana</span>
        {spread ? <span className="text-xs text-(--muted) stat-num">{spread}</span> : null}
        {commanderHere ? <span className="text-xs">commander: <CardName name={commanderHere} /></span> : null}
      </div>
      {step.jobs.length ? (
        <ul className="flex flex-col gap-0.5">
          {step.jobs.map((g) => <Job key={g.job} label={JOB_LABEL[g.job]} cards={g.cards.map((c) => c.name)} />)}
        </ul>
      ) : (
        <span className="text-xs text-(--muted)">Nothing new costs {step.mana}: the turn goes to what is already castable.</span>
      )}
    </li>
  );
}

function Job({ label, cards }: { label: string; cards: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, NAMED);
  return (
    <li className="text-xs" data-testid="first-turn-job">
      <span className="text-(--muted)">{cards.length} {label}: </span>
      {shown.map((n, i) => <span key={n}>{i > 0 ? <span className="text-(--muted)"> · </span> : null}<CardName name={n} /></span>)}
      {cards.length > NAMED ? (
        <>
          {" "}
          <button type="button" className="text-(--accent) underline underline-offset-2 py-1 -my-1" onClick={() => setAll(!all)}>
            {all ? "fewer" : `+${cards.length - NAMED} more`}
          </button>
        </>
      ) : null}
    </li>
  );
}
