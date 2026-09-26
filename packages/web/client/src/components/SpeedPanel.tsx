import type { DeckReport } from "../types.js";
import { fastestRoute, speedRoutes, type SpeedRoute } from "../lib/speed.js";
import { CardName } from "./card-drawer.js";

/** Cards named on a route before "and N more": the list is evidence, not the point. */
const NAMED = 5;

/** HOW FAST IT CAN WIN, ONE LINE PER ROUTE. See `lib/speed.ts` for what each line measures. */
export function SpeedPanel({ report, manaValueOf }: { report: DeckReport; manaValueOf: (name: string) => number | undefined }) {
  const routes = speedRoutes(report, manaValueOf);
  if (!routes.length) return null;
  const fastest = fastestRoute(routes);
  return (
    <div className="flex flex-col gap-3 max-w-4xl" data-testid="speed-panel">
      <h3 className="eyebrow text-(--foreground)">How fast it can win</h3>
      <p className="text-sm max-w-[65ch]" data-testid="speed-headline">
        {fastest
          ? <>Fastest route: {fastest.label}, around <b>turn {fastest.turn}</b>{fastest.kind === "combo" ? " at the earliest" : ""}.</>
          : <>None of this deck&rsquo;s routes to a win can be timed from the list.</>}
        {" "}Every way it can win is below, with what each number counts.
      </p>
      <ul className="flex flex-col gap-2">
        {routes.map((r) => <Route key={r.kind} r={r} />)}
      </ul>
    </div>
  );
}

function Route({ r }: { r: SpeedRoute }) {
  // Only a route timed by mana has a fast-game and a slow-game turn; the combat clock is one number.
  const spread = r.mana !== undefined && r.turn !== undefined && (r.early !== r.turn || r.late !== r.turn)
    ? ` · turn ${r.early ?? "?"} in fast games, ${r.late !== undefined ? `turn ${r.late}` : "later than turn 8"} in slow ones`
    : "";
  return (
    <li className="rounded-lg border border-(--separator) px-3 py-2 flex flex-col gap-1" data-testid="speed-route">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <span className="text-sm">{r.label.charAt(0).toUpperCase() + r.label.slice(1)}</span>
        <span className="text-xs stat-num text-(--muted) sm:whitespace-nowrap">
          {r.turn !== undefined ? `turn ${r.turn}${r.mana !== undefined ? ` (${r.mana} mana)` : ""}${spread}` : "not timed"}
        </span>
      </div>
      <span className="text-xs text-(--muted)">{r.caveat.charAt(0).toUpperCase() + r.caveat.slice(1)}.</span>
      {r.cards.length && r.kind !== "combo" ? (
        <span className="text-xs text-(--muted)">
          {r.cards.slice(0, NAMED).map((n, i) => <span key={n}>{i > 0 ? ", " : ""}<CardName name={n} /></span>)}
          {r.cards.length > NAMED ? ` and ${r.cards.length - NAMED} more` : ""}
        </span>
      ) : null}
    </li>
  );
}
