import type { DeckReport } from "../types.js";
import { speedRoutes } from "../lib/speed.js";
import { WinPlans } from "./WinPlans.js";

/** HOW YOU WIN, AND HOW FAST, AS ONE SECTION (owner, 2026-09-27: "How fast it can win and How you
 *  win" were walls of text "no one is going to read"). They were two lists of the same plans a
 *  screen apart: "How fast it can win" one card per route with its caveat, then "How you win" a
 *  combat-pressure row, its modelling paragraph and a card list per plan. Now each plan is one tile
 *  carrying its own turn, and one plan's cards are read at a time (`WinPlans`). */
export function HowYouWin({ report, manaValueOf }: { report: DeckReport; manaValueOf: (name: string) => number | undefined }) {
  const deckMath = report.deckMath;
  const wincons = deckMath?.wincons;
  if (!deckMath || !wincons?.classes.length) return null;
  const routes = speedRoutes(report, manaValueOf);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="how-you-win">
      <h3 id="how-you-win" className="eyebrow text-(--foreground)">How you win</h3>
      <WinPlans wincons={wincons} routes={routes} pressure={deckMath.clock.turn !== undefined ? deckMath.clock.powerAtFive : undefined} />
      {deckMath.topdeck.length ? (
        // Off the top: what a card that plays from the library gets from it, one line each.
        <ul className="flex flex-col gap-1 text-xs text-(--muted) max-w-[65ch]">
          {deckMath.topdeck.map((t) => (
            <li key={t.card}>
              <span className="text-(--foreground)">{t.card}</span>: a card off the top is worth {t.meanManaValue} mana on average
              {t.castable ? `, and ${Math.round(t.castable.share * 100)}% of your library is ${t.castable.types.join(" or ")}, which it casts for free` : ""}.
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
