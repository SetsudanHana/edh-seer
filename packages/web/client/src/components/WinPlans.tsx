import { useState } from "react";
import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";
import { fastestRoute, type SpeedRoute } from "../lib/speed.js";
import type { EngineModel } from "../lib/engine-model.js";
import { PlanMap } from "./PlanMap.js";

type Wincons = NonNullable<DeckReport["deckMath"]>["wincons"];

/** Names shown on a plan before "Show all": enough to recognise the plan, short enough to scan. */
const NAMED = 8;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const phrase = (cls: string) => WIN_PHRASE[cls] ?? cls;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which timed route answers for a plan: combat plans share the clock. */
const ROUTE_OF: Record<string, SpeedRoute["kind"]> = {
  combo: "combo", "alt-win": "alt-win", "go-wide": "combat", stompy: "combat", voltron: "combat", burn: "burn", mill: "mill",
};

/** HOW THE DECK WINS, WITH THE CARDS THAT DO IT, AND HOW FAST (owner, 2026-09-26: "we should be able
 *  to determine how the deck can win"; 2026-09-27: "How fast it can win and How you win" were walls
 *  of text "no one is going to read"). Each plan is a tile: its name, the turn it can win by and how
 *  many cards carry it. The picked plan's cards are read one plan at a time, drawn as a
 *  map where the deck's links are known.
 *
 *  `routes` are `speedRoutes`: without them (the build panel's own copy) the tiles have no turn. */
export function WinPlans({ wincons, routes, pressure, model }: {
  wincons: Wincons; routes?: SpeedRoute[];
  /** The deck's links: with them, the picked plan is drawn as a map (`PlanMap`) instead of named. */
  model?: EngineModel | null;
  /** The combat clock's snapshot on the way there: expected power on board by turn 5. */
  pressure?: number;
}) {
  const { classes, focus } = wincons;
  const [picked, setPicked] = useState(classes[0]?.class ?? "");
  const plan = classes.find((c) => c.class === picked) ?? classes[0];
  if (!classes.length || !plan) return null;
  const routeOf = (cls: string) => routes?.find((r) => r.kind === ROUTE_OF[cls]);
  const fastest = routes ? fastestRoute(routes) : undefined;
  const [first] = classes;
  const lean = focus >= 0.8
    ? `Nearly all-in on ${phrase(first!.class)}.`
    : focus >= 1 / Math.max(1, classes.length) + 0.15
    ? `Leans on ${phrase(first!.class)}.`
    : classes.length > 1 ? `Spread about evenly across ${classes.length} plans.` : "";
  const pickable = classes.length > 1;
  const route = routeOf(plan.class);
  return (
    <div className="flex flex-col gap-3" data-testid="win-plans">
      <p className="text-sm max-w-[65ch]" data-testid="win-plans-headline">
        {fastest ? <>Fastest: {fastest.label}, around <b>turn {fastest.turn}</b>{fastest.kind === "combo" ? " at the earliest" : ""}. </> : null}
        {lean}
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 max-w-2xl" role={pickable ? "group" : undefined} aria-label={pickable ? "Pick a plan" : undefined}>
        {classes.map((c) => <Tile key={c.class} plan={c} route={routes ? routeOf(c.class) ?? null : undefined}
          picked={pickable && c.class === plan.class} onPick={pickable ? () => setPicked(c.class) : undefined} />)}
      </div>
      <Detail plan={plan} route={route} pressure={route?.kind === "combat" ? pressure : undefined} model={model} />
    </div>
  );
}

function Tile({ plan, route, picked, onPick }: { plan: Wincons["classes"][number]; route?: SpeedRoute | null; picked?: boolean; onPick?: () => void }) {
  const label = cap(phrase(plan.class));
  const body = (
    <>
      <span className="text-sm leading-snug">{label}</span>
      {route !== undefined ? (
        // AN ALTERNATE WIN IS TIMED BY WHEN ITS CARD CAN BE CAST, NOT WHEN IT WINS (persona round
        // 2026-09-27: "An alternate win condition · turn 1" read as a turn-1 win beside "Fastest …
        // around turn 9"). It says so, small, as an untimed tile does.
        route?.kind === "alt-win" && route.turn !== undefined
          ? <span className="text-xs text-(--muted)">cast by turn {route.turn}</span>
          : <span className="stat-num text-lg leading-none">{route?.turn !== undefined ? `turn ${route.turn}` : <span className="text-xs text-(--muted)">no turn estimate</span>}</span>
      ) : null}
      <span className="text-xs stat-num text-(--muted)">{plural(plan.count, "card")}</span>
    </>
  );
  const cls = `flex flex-col items-start gap-1 rounded-(--radius) border px-3 py-2 text-left ${picked ? "border-(--accent) bg-(--surface-secondary)" : "border-(--separator)"}`;
  return onPick ? (
    <button type="button" aria-pressed={picked} onClick={onPick} data-testid="win-plan" className={`${cls} hover:border-(--foreground)`}>{body}</button>
  ) : <div data-testid="win-plan" className={cls}>{body}</div>;
}

/** The one plan picked: when it can win, what put its cards there, and the cards. */
function Detail({ plan, route, pressure, model }: { plan: Wincons["classes"][number]; route?: SpeedRoute; pressure?: number; model?: EngineModel | null }) {
  // THE PLAN AS A MAP, THE FINISHERS IN THE MIDDLE (report cohesion audit, 2026-09-27); a plan
  // with no finishers named is drawn round the commander.
  const middle = plan.payoffs?.length ? plan.payoffs
    : model ? [...model.cards.values()].filter((c) => c.isCommander && !c.isFace).map((c) => c.name) : [];
  const map = model && plan.cards?.length && middle.length
    ? <PlanMap model={model} middle={middle} around={plan.cards} /> : null;
  const spread = route?.turn !== undefined && route.mana !== undefined && (route.early !== route.turn || route.late !== route.turn)
    ? ` (turn ${route.early ?? "?"} in fast games, ${route.late !== undefined ? `turn ${route.late}` : "later than turn 8"} in slow ones)` : "";
  return (
    <div className="flex flex-col gap-2" data-testid="win-plan-detail">
      <p className="text-sm"><b>{cap(phrase(plan.class))}</b> · {plural(plan.count, "card")}</p>
      {route?.kind === "alt-win" && route.turn !== undefined ? (
        <p className="text-sm">Its cheapest card can be cast around <b>turn {route.turn}</b>; its own win condition still has to be met after that.</p>
      ) : route?.turn !== undefined ? (
        <p className="text-sm">
          Can win around <b>turn {route.turn}</b>{spread}
          {route.kind === "combo" ? <>, with {route.cards.join(" + ")}</> : null}
          {pressure !== undefined ? <span className="text-(--muted)">; about {Math.round(pressure)} power of creatures in play by turn 5</span> : null}.
        </p>
      ) : route ? <p className="text-xs text-(--muted)">No turn: {route.caveat}.</p> : null}
      {map ?? (
        <>
          {plan.cards?.length ? <Names lead={plan.payoffs ? "Makes the board" : undefined} names={plan.cards} /> : null}
          {plan.payoffs?.length ? <Names lead="Turns it into a win" names={plan.payoffs} /> : null}
        </>
      )}
    </div>
  );
}

function Names({ lead, names }: { lead?: string; names: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? names : names.slice(0, NAMED);
  return (
    <div className="flex flex-col gap-1" data-testid="win-plan-cards">
      {lead ? <span className="eyebrow text-(--muted)">{lead}</span> : null}
      <span className="flex flex-wrap gap-1">
        {shown.map((n) => <span key={n} className="rounded-full border border-(--separator) px-2 py-0.5 text-xs"><CardName name={n} /></span>)}
        {names.length > NAMED ? (
          <button type="button" className="rounded-full px-2 py-0.5 text-xs text-(--accent) underline underline-offset-2" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${names.length}`}
          </button>
        ) : null}
      </span>
    </div>
  );
}
