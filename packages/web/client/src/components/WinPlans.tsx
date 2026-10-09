import { useState } from "react";
import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";
import { fastestRoute, type SpeedRoute } from "../lib/speed.js";
import type { EngineCard, EngineModel } from "../lib/engine-model.js";
import { Art } from "./engine-parts.js";

type Wincons = NonNullable<DeckReport["deckMath"]>["wincons"];

/** Names shown on a plan before "Show all": enough to recognise the plan, short enough to scan. */
const NAMED = 8;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const phrase = (cls: string) => WIN_PHRASE[cls] ?? cls;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which timed route answers for a plan: combat plans share the board's turn; voltron reads its
 *  commander-damage turn when it has one (#1056 R2), and the board's otherwise. */
const ROUTE_OF: Record<string, SpeedRoute["kind"]> = {
  combo: "combo", "alt-win": "alt-win", "go-wide": "combat", stompy: "combat", voltron: "commander", burn: "burn", mill: "mill",
};

/** HOW THE DECK WINS, WITH THE CARDS THAT DO IT, AND HOW FAST (owner, 2026-09-26: "we should be able
 *  to determine how the deck can win"; 2026-09-27: "How fast it can win and How you win" were walls
 *  of text "no one is going to read"). Each plan is a tile: its name, the turn it can win by and how
 *  many cards carry it. The picked plan's cards are read one plan at a time: the cards that win
 *  first, then the cards that set them up.
 *
 *  `routes` are `speedRoutes`: without them (the build panel's own copy) the tiles have no turn. */
export function WinPlans({ wincons, routes, pressure, model }: {
  wincons: Wincons; routes?: SpeedRoute[];
  /** The deck's cards: with them, each named card carries its art. */
  model?: EngineModel | null;
  /** The combat clock's snapshot on the way there: expected power on board by turn 5. */
  pressure?: number;
}) {
  const { classes, focus } = wincons;
  const [picked, setPicked] = useState(classes[0]?.class ?? "");
  const plan = classes.find((c) => c.class === picked) ?? classes[0];
  if (!classes.length || !plan) return null;
  // A voltron plan reads its commander-damage turn when it HAS one, and the board's otherwise: every
  // voltron deck with a readable commander gets a commander route, timed or not, and an untimed one
  // must not hide a timed board (review of #1056 R2).
  const routeOf = (cls: string) => {
    const own = routes?.find((r) => r.kind === ROUTE_OF[cls]);
    if (cls !== "voltron") return own;
    const board = routes?.find((r) => r.kind === "combat");
    return own?.turn !== undefined ? own : board?.turn !== undefined ? board : own ?? board;
  };
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
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role={pickable ? "group" : undefined} aria-label={pickable ? "Pick a plan" : undefined}>
        {classes.map((c) => <Tile key={c.class} plan={c} route={routes ? routeOf(c.class) ?? null : undefined}
          picked={pickable && c.class === plan.class} onPick={pickable ? () => setPicked(c.class) : undefined} />)}
      </div>
      <Detail plan={plan} route={route} pressure={route?.kind === "combat" || route?.kind === "commander" ? pressure : undefined} model={model} />
    </div>
  );
}

function Tile({ plan, route, picked, onPick }: { plan: Wincons["classes"][number]; route?: SpeedRoute | null; picked?: boolean; onPick?: () => void }) {
  const label = cap(phrase(plan.class));
  const body = (
    <>
      <span className="text-sm leading-snug">{label}</span>
      {route !== undefined ? (
        // AN ALTERNATE WIN HAS NO TURN ON ITS TILE (persona rounds 2026-09-27 and 2026-09-29). "turn 1"
        // read as a turn-1 win; "cast by turn 1" still did, beside "Fastest … around turn 9", because
        // the card it timed was Vorpal Sword -- one mana to cast, eight to turn on. When the card can
        // be cast is in the detail, named; the tile says what kind of plan it is.
        route?.kind === "alt-win"
          ? <span className="text-xs text-(--muted)">wins on its own condition</span>
          // AN UNTIMED ROUTE SAYS WHY ON ITS FACE (persona round 2026-09-29, four seats): "no turn
          // estimate" read as a hole, where it is a limit the report states.
          : <span className="stat-num text-lg leading-none">{route?.turn !== undefined ? `turn ${route.turn}` : <span className="text-xs text-(--muted)">{route?.needsFinisher ? "needs a finisher" : "speed not modelled"}</span>}</span>
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
  // THE CARDS, NOT A MAP (owner, 2026-09-27: "I have no idea what the How you win graph should
  // represent"). The finishers lead, since they are the answer to "how does it win"; the cards that
  // set them up follow, each once.
  const art = new Map<string, EngineCard>();
  // A two-faced card is named whole ("Kuja, Genome Sorcerer // Trance Kuja, Fate Defied"): its art
  // is on its faces, so the whole name finds its front one.
  if (model) for (const c of model.cards.values()) {
    if (c.isToken) continue;
    for (const n of [c.name, c.physical]) if (n && (!art.has(n) || (!art.get(n)!.art && c.art))) art.set(n, c);
  }
  // A COMBO'S WIN IS ITS PAYOFF (persona round 2026-09-29, plan-seeker: "what actually kills in the
  // Dualcaster loop? The page lists only 'Infinite creature ETB…'"). The loop's payoffs are the
  // cards the Combos page names under "Wins through"; they lead here too.
  const comboWins = route?.kind === "combo" ? route.payoffs ?? [] : [];
  const wins = plan.payoffs?.length ? plan.payoffs : comboWins;
  const setup = (plan.cards ?? []).filter((n) => !wins.includes(n));
  // THE SPREAD for a route timed off mana (combo) and for combat, timed by the simulated games
  // themselves (owner 2026-10-07); a slow quarter past the simulated turns says so.
  const spread = route?.turn !== undefined && (route.mana !== undefined || (route.kind === "combat" && route.early !== undefined)) && (route.early !== route.turn || route.late !== route.turn)
    ? ` (turn ${route.early ?? "?"} in fast games, ${route.late !== undefined ? `turn ${route.late}` : `later than turn ${route.kind === "combat" ? 20 : 8}`} in slow ones)` : "";
  return (
    <div className="flex flex-col gap-2" data-testid="win-plan-detail">
      <p className="text-sm"><b>{cap(phrase(plan.class))}</b> · {plural(plan.count, "card")}</p>
      {route?.kind === "alt-win" && route.turn !== undefined ? (
        <p className="text-sm">Its cheapest card{route.card ? <>, {route.card},</> : null} can be cast around <b>turn {route.turn}</b>; its own win condition still has to be met after that, so this is not when it wins.</p>
      ) : route?.turn !== undefined ? (
        <p className="text-sm">
          {/* A LOOP GOES INFINITE; ITS PAYOFF WINS (persona round 2026-09-29). "Can win" beside "no card
            *  here turns the loop into a win" said both. */}
          {route.kind === "combo" ? "Can go infinite" : "Can win"} around <b>turn {route.turn}</b>{spread}
          {route.kind === "combo" ? <>, with {route.cards.join(" + ")}</> : null}
          {pressure !== undefined ? <span className="text-(--muted)">; about {Math.round(pressure)} power of creatures in play by turn 5</span> : null}.
        </p>
      ) : route ? <p className="text-xs text-(--muted)">No turn: {route.caveat}.</p> : null}
      {wins.length ? <Names lead="Turns it into a win" names={wins} art={art} /> : route?.kind === "combo" && route.winsBy ? (
        <p className="text-sm">The loop wins by itself: {route.winsBy}.</p>
      ) : route?.kind === "combo" && !route.needsFinisher ? (
        <p className="text-xs text-(--muted)">No card here was found that turns what the loop repeats into a win.</p>
      ) : null}
      {setup.length ? <Names lead={wins.length ? (plan.class === "combo" ? "The loop" : "Makes the board") : undefined} names={setup} art={art} /> : null}
    </div>
  );
}

function Names({ lead, names, art }: { lead?: string; names: string[]; art: Map<string, EngineCard> }) {
  const [all, setAll] = useState(false);
  const shown = all ? names : names.slice(0, NAMED);
  return (
    <div className="flex flex-col gap-1" data-testid="win-plan-cards">
      {lead ? <span className="eyebrow text-(--muted)">{lead}</span> : null}
      <span className="flex flex-wrap gap-1.5">
        {shown.map((n) => {
          const c = art.get(n);
          return (
            <span key={n} className={`inline-flex min-h-9 items-center gap-1.5 rounded-(--radius) border border-(--separator) py-0.5 text-sm ${c ? "pl-0.5 pr-2.5" : "px-2.5"}`}>
              {c ? <Art card={c} size={24} /> : null}
              <CardName name={n} />
            </span>
          );
        })}
        {names.length > NAMED ? (
          <button type="button" className="min-h-9 rounded-full px-2 text-xs text-(--accent) underline underline-offset-2" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${names.length}`}
          </button>
        ) : null}
      </span>
    </div>
  );
}
