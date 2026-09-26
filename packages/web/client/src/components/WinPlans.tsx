import { useState } from "react";
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
  if (!classes.length) return null;
  const [first, ...rest] = classes;
  const others = listWords(rest.map((c) => phrase(c.class)));
  const headline = focus >= 0.8
    ? `Nearly all-in on ${phrase(first!.class)}.`
    : focus >= 1 / Math.max(1, classes.length) + 0.15
    ? `Leans on ${phrase(first!.class)}${rest.length ? `, with ${others} beside it` : ""}.`
    : `Spread about evenly across ${classes.length} plans (${listWords(classes.map((c) => phrase(c.class)))}), so no one plan has most of the deck's win cards.`;
  return (
    <div className="flex flex-col gap-2" data-testid="win-plans">
      <h4 className="eyebrow">Win plans</h4>
      <p className="text-sm max-w-[65ch]" data-testid="win-plans-headline">{headline}</p>
      <ul className="flex flex-col gap-2">
        {classes.map((c) => <Plan key={c.class} plan={c} />)}
      </ul>
      <p className="text-xs text-(--muted) max-w-[65ch]">
        Each plan is read off what the cards say, so one card can sit on two plans, and a card that
        only looks like one (an aura that removes a creature, say) can land on the wrong one. Tap a
        card to check it.
      </p>
    </div>
  );
}

function Plan({ plan }: { plan: Wincons["classes"][number] }) {
  const label = phrase(plan.class);
  return (
    <li className="rounded-lg border border-(--separator) px-3 py-2 flex flex-col gap-1" data-testid="win-plan">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
        <span className="text-xs stat-num text-(--muted)">{plural(plan.count, "card")}</span>
      </div>
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
