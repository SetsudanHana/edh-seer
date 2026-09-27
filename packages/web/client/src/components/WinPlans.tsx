import { useContext, useMemo, useState } from "react";
import { idsOf, linksWithin } from "../lib/deck-sky.js";
import { DeckSky, SkyContext } from "./DeckSky.js";
import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";
import { fastestRoute, type SpeedRoute } from "../lib/speed.js";

type Wincons = NonNullable<DeckReport["deckMath"]>["wincons"];

/** Names shown on a plan before "Show all": enough to recognise the plan, short enough to scan. */
const NAMED = 8;

/** WHAT PUT A CARD ON EACH PLAN, in the words of the rule that did (`matcher/src/rules.json` and
 *  `wincon.ts`). A player checks a plan by its cards, and can only catch a wrong card if the page
 *  says what a right one looks like. */
const WHAT_COUNTS: Record<string, string> = {
  "go-wide": "cards that make creature tokens; they count only because the deck also has cards that pay a wide board off",
  voltron: "equipment, and auras that enchant a creature",
  stompy: "creatures with more power than their mana value",
  burn: "cards that deal damage or make players lose life outside combat",
  mill: "cards that make opponents mill",
  "alt-win": "cards that say you win the game",
  combo: "pieces of the combos Commander Spellbook knows in this deck; not every one of those combos wins the game on its own",
};

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
 *  many cards carry it. The picked plan's cards, what put them there and what its turn counts are
 *  read one plan at a time, beside the sky lighting them. What every number ignores sits behind one
 *  disclosure at the foot, not under every line.
 *
 *  `routes` are `speedRoutes`: without them (the build panel's own copy) the tiles have no turn. */
export function WinPlans({ wincons, routes, pressure }: {
  wincons: Wincons; routes?: SpeedRoute[];
  /** The combat clock's snapshot on the way there: expected power on board by turn 5. */
  pressure?: number;
}) {
  const { classes, focus } = wincons;
  // THE PLAN ON THE DECK'S SKY (owner, 2026-09-27): the picked plan's cards lit, its finishers
  // named, and the links between them in pink -- a plan whose cards work together draws a shape,
  // one whose cards do not is a scatter of stars.
  const model = useContext(SkyContext);
  const [picked, setPicked] = useState(classes[0]?.class ?? "");
  const plan = classes.find((c) => c.class === picked) ?? classes[0];
  const light = useMemo(() => {
    if (!model || !plan) return null;
    // THE PLAN'S OWN COUNT, THEN ITS FINISHERS (persona round, 2026-09-27: "8 cards" over the plan
    // and "its 9 cards lit" under the sky). The finishers are counted apart, as the plan lists them.
    const cards = idsOf(model, plan.cards ?? []);
    const payoffs = new Set([...idsOf(model, plan.payoffs ?? [])].filter((id) => !cards.has(id)));
    const ids = new Set([...cards, ...payoffs]);
    if (!ids.size) return null;
    const lines = linksWithin(model, ids);
    const name = phrase(plan.class);
    const what = `${plural(cards.size, "card")}${payoffs.size ? ` and ${plural(payoffs.size, "finisher")}` : ""}`;
    return { ids, lines, label: `${cap(name)}: its ${what} lit${lines.length ? `, and the ${plural(lines.length, "link")} between them in pink` : ", with no links between them"}.` };
  }, [model, plan]);
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
      {/* SIDE BY SIDE ONLY WHERE THE PANEL IS WIDE: the screen's width says nothing about its own. */}
      <div className="@container">
        <div className={light ? "flex flex-col gap-4 @min-[44rem]:grid @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] @min-[44rem]:items-start @min-[44rem]:gap-6" : "flex flex-col gap-4"}>
          <Detail plan={plan} route={route} pressure={route?.kind === "combat" ? pressure : undefined} />
          {light && model ? <DeckSky model={model} lit={light} className="w-full max-w-[26rem]" /> : null}
        </div>
      </div>
      <details className="max-w-[65ch]">
        <summary className="eyebrow cursor-pointer text-(--muted)">what the plans and turns count</summary>
        <ul className="flex flex-col gap-1.5 pt-2 text-xs text-(--muted)">
          <li>Each plan is read off what the cards say, so one card can sit on two plans, and a card that only looks like one (an aura that removes a creature, say) can land on the wrong one. Tap a card to check it.</li>
          {routes?.map((r) => <li key={r.kind}>{cap(r.label)}: {r.caveat}.</li>)}
          {routes?.some((r) => r.kind === "combat") ? (
            <li>The combat turn is attacking power against ONE opponent&rsquo;s 40 life, not the table: nobody blocks, nothing is removed, and every point of mana goes to creatures. Read it to compare decks, not to plan a game.</li>
          ) : null}
        </ul>
      </details>
    </div>
  );
}

function Tile({ plan, route, picked, onPick }: { plan: Wincons["classes"][number]; route?: SpeedRoute | null; picked?: boolean; onPick?: () => void }) {
  const label = cap(phrase(plan.class));
  const body = (
    <>
      <span className="text-sm leading-snug">{label}</span>
      {route !== undefined ? (
        <span className="stat-num text-lg leading-none">{route?.turn !== undefined ? `turn ${route.turn}` : <span className="text-xs text-(--muted)">not timed</span>}</span>
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
function Detail({ plan, route, pressure }: { plan: Wincons["classes"][number]; route?: SpeedRoute; pressure?: number }) {
  const spread = route?.turn !== undefined && route.mana !== undefined && (route.early !== route.turn || route.late !== route.turn)
    ? ` (turn ${route.early ?? "?"} in fast games, ${route.late !== undefined ? `turn ${route.late}` : "later than turn 8"} in slow ones)` : "";
  return (
    <div className="flex flex-col gap-2" data-testid="win-plan-detail">
      <p className="text-sm"><b>{cap(phrase(plan.class))}</b> · {plural(plan.count, "card")}</p>
      {route?.turn !== undefined ? (
        <p className="text-sm">
          Can win around <b>turn {route.turn}</b>{spread}
          {route.kind === "combo" ? <>, with {route.cards.join(" + ")}</> : null}
          {pressure !== undefined ? <span className="text-(--muted)">; {pressure} power on board by turn 5</span> : null}.
        </p>
      ) : route ? <p className="text-xs text-(--muted)">No turn: {route.caveat}.</p> : null}
      <p className="text-xs text-(--muted)">{cap(WHAT_COUNTS[plan.class] ?? "")}.</p>
      {plan.cards?.length ? <Names lead={plan.payoffs ? "Makes the board" : undefined} names={plan.cards} /> : null}
      {plan.payoffs?.length ? <Names lead="Turns it into a win" names={plan.payoffs} /> : null}
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
