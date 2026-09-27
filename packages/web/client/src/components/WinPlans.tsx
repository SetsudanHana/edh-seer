import { useContext, useMemo, useState } from "react";
import { idsOf, linksWithin } from "../lib/deck-sky.js";
import { DeckSky, SkyContext } from "./DeckSky.js";
import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

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
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** HOW THE DECK WINS, WITH THE CARDS THAT DO IT (owner, 2026-09-26: "we should be able to
 *  determine how the deck can win"). This was one line, "Mostly go-wide 8 cards · voltron 7 cards ·
 *  burn 6 cards · combo 6 cards", and the baseline round's plan seat, whose Reddit-grounded "solved"
 *  is naming the cards that win ("pick a way" is r/EDH's first advice to a deck that stalls), could
 *  not name one. Each plan now says what put a card on it and lists the cards; go-wide splits the
 *  cards that make the board from the ones that turn it into a win. */
export function WinPlans({ wincons }: { wincons: Wincons }) {
  const { classes, focus } = wincons;
  // THE PLAN ON THE DECK'S SKY (owner, 2026-09-27): the picked plan's cards lit, its finishers
  // named, and the links between them in gold -- a plan whose cards work together draws a shape,
  // one whose cards do not is a scatter of stars.
  const model = useContext(SkyContext);
  const [picked, setPicked] = useState(classes[0]?.class ?? "");
  const plan = classes.find((c) => c.class === picked) ?? classes[0];
  const light = useMemo(() => {
    if (!model || !plan) return null;
    const ids = idsOf(model, [...(plan.cards ?? []), ...(plan.payoffs ?? [])]);
    if (!ids.size) return null;
    const lines = linksWithin(model, ids);
    const name = phrase(plan.class);
    return { ids, lines, label: `${name.charAt(0).toUpperCase()}${name.slice(1)}: its ${plural(ids.size, "card")} lit${lines.length ? `, and the ${plural(lines.length, "link")} between them in gold` : ", with no links between them"}.` };
  }, [model, plan]);
  if (!classes.length || !plan) return null;
  const [first, ...rest] = classes;
  const others = listWords(rest.map((c) => phrase(c.class)));
  const headline = focus >= 0.8
    ? `Nearly all-in on ${phrase(first!.class)}.`
    : focus >= 1 / Math.max(1, classes.length) + 0.15
    ? `Leans on ${phrase(first!.class)}${rest.length ? `, with ${others} beside it` : ""}.`
    : `Spread about evenly across ${classes.length} plans (${listWords(classes.map((c) => phrase(c.class)))}), so no one plan has most of the deck's win cards.`;
  const pickable = !!model && classes.length > 1;
  return (
    <div className="flex flex-col gap-2" data-testid="win-plans">
      <h4 className="eyebrow">Win plans</h4>
      <p className="text-sm max-w-[65ch]" data-testid="win-plans-headline">{headline}</p>
      {/* SIDE BY SIDE ONLY WHERE THE PANEL IS WIDE: it sits in a column of the build panel, so the
        * screen's width says nothing about its own (a 1440 screen squeezed the plans to 120px). */}
      <div className={light ? "@container" : "contents"}>
      <div className={light ? "flex flex-col gap-4 @min-[44rem]:grid @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @min-[44rem]:items-start @min-[44rem]:gap-6" : "contents"}>
      <ul className="flex flex-col gap-2">
        {classes.map((c) => <Plan key={c.class} plan={c} picked={pickable && c.class === plan.class} onPick={pickable ? () => setPicked(c.class) : undefined} />)}
      </ul>
      {light && model ? <DeckSky model={model} lit={light} className="w-full max-w-[26rem]" /> : null}
      </div>
      </div>
      <p className="text-xs text-(--muted) max-w-[65ch]">
        Each plan is read off what the cards say, so one card can sit on two plans, and a card that
        only looks like one (an aura that removes a creature, say) can land on the wrong one. Tap a
        card to check it.
      </p>
    </div>
  );
}

function Plan({ plan, picked, onPick }: { plan: Wincons["classes"][number]; picked?: boolean; onPick?: () => void }) {
  const label = phrase(plan.class);
  const head = (
    <>
      <span className="text-sm">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
      <span className="text-xs stat-num text-(--muted)">{plural(plan.count, "card")}</span>
    </>
  );
  return (
    <li className={`rounded-lg border px-3 py-2 flex flex-col gap-1 ${picked ? "border-(--accent)" : "border-(--separator)"}`} data-testid="win-plan">
      {onPick ? (
        // A PLAN IS PICKED TO SEE IT ON THE SKY: the whole head is the button, saying which is lit.
        <button type="button" aria-pressed={picked} onClick={onPick} className="flex min-h-9 flex-wrap items-baseline gap-x-2 text-left hover:text-(--accent)">
          {head}
          <span className="text-xs text-(--muted)">{picked ? "on the sky" : "show on the sky"}</span>
        </button>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2">{head}</div>
      )}
      <span className="text-xs text-(--muted)">
        {(WHAT_COUNTS[plan.class] ?? "").replace(/^./, (ch) => ch.toUpperCase())}.
      </span>
      {plan.cards?.length ? (
        <Names lead={plan.payoffs ? "Makes the board" : undefined} names={plan.cards} />
      ) : null}
      {plan.payoffs?.length ? <Names lead="Turns it into a win" names={plan.payoffs} /> : null}
    </li>
  );
}

function Names({ lead, names }: { lead?: string; names: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? names : names.slice(0, NAMED);
  return (
    <span className="text-xs" data-testid="win-plan-cards">
      {lead ? <span className="text-(--muted)">{lead}: </span> : null}
      {shown.map((n, i) => <span key={n}>{i > 0 ? <span className="text-(--muted)"> · </span> : ""}<CardName name={n} /></span>)}
      {names.length > NAMED ? (
        <>
          {" "}
          <button type="button" className="text-(--accent) underline underline-offset-2 py-1 -my-1" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${names.length}`}
          </button>
        </>
      ) : null}
    </span>
  );
}
