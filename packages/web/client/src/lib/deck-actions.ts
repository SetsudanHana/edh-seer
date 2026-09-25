import { createContext, useContext, type ReactNode } from "react";

/** THE DECK'S ACTIONS, HANDED TO THE REPORT'S SUMMARY ROW (UI review 2026-09-25).
 *
 *  Once a report is on screen the collapsed deck bar was a 70px box holding "100 cards" -- which
 *  the glance chapter prints again -- and five buttons, on every surface above the summary row
 *  that already names the deck. The buttons now sit at the right end of that row instead, and the
 *  box goes.
 *
 *  A CONTEXT, NOT A PROP CHAIN: `App` owns the handlers and the report is a lazy chunk three
 *  components down, so this module stays tiny and keeps `ReportHeader` out of the entry bundle.
 *  No provider (every test that renders the report alone) means no actions, and the row is as it
 *  was. */
const DeckActionsContext = createContext<ReactNode>(null);

export const DeckActionsProvider = DeckActionsContext.Provider;

export function useDeckActions(): ReactNode {
  return useContext(DeckActionsContext);
}
