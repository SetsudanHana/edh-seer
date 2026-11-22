import type { Action } from "../canonicalize.js";
import { graveyardOwner } from "./graveyard-owner.js";
import { searchedLibraryOwner } from "./library-search.js";
import type { Source } from "./references.js";

/** A PUT THE WORDS TAKE OUT OF YOUR OWN ZONE IS OF A CARD YOU OWN (#1737; CR 400.3: an object that would go to a library, graveyard or hand other than its owner's goes to its owner's, so each of those zones holds only
 *  its owner's cards; CR 108.3: a card's owner is the player who started the game with it in their deck). The `enters` emit then says `owner: you`, which "whenever a nonland permanent an opponent owns enters the battlefield under
 *  your control" (Brainstealer Dragon, `owner: opp`) refuses in the matcher (edges.ts `originMatches`): Primal Surge, Stitch Together, Revivify and every tutor-to-battlefield met it.
 *  The origin read is one of four, and only a zone the words call YOURS:
 *   - a graveyard: `graveyardOwner` (#1470), which reads "from your graveyard", a pointer back at "your graveyard" and a "your hand or graveyard" list, and refuses any graveyard that is not (only) yours;
 *   - a library: the clause's own search says it is yours (`searchedLibraryOwner`), or the put's object / the clause names "your library" and no other;
 *   - a hand: "from your hand" and no other player's hand;
 *   - exile: the card the clause exiled FROM your library, hand or graveyard one action earlier (Primal Surge's "Exile the top card of your library ... put it onto the battlefield").
 *  `zone` is the ORIGIN the emit states: the stored answer's action says it (`fromZone`), the grammar's records leave it null and the emit's own `fromZone` is read off the object (Cryptic Gateway, Kastral), so both readings must stamp alike.
 *  CEILING: a put out of ANY graveyard ("a graveyard", Animate Dead, Reanimate), out of exile with no earlier exile of your own zone in the clause (a flicker, "cards exiled with this"), and a put the model stored with no origin
 *  keep no owner: the card could be an opponent's, or the words do not say. "Return that card to the battlefield under its owner's control" after an exile of ANY creature (Long Road Home) keeps none too: its `control: any` is read
 *  by the matcher as possibly yours, though the card returns under its owner's control. A shared pile ("exiled with this permanent") is not read. */
const NOT_YOURS = (zone: string): RegExp => new RegExp(`\\b(?:opponents?['\\u2019]s?|players?['\\u2019]s?|their|that player['\\u2019]s|its owner['\\u2019]s|a|an|each|any|another|every|target player['\\u2019]s) ${zone}s?\\b`, "i");
const YOURS = (zone: string): RegExp => new RegExp(`\\b(?:from|in|of) your (?:own )?${zone}\\b|\\bthe top (?:card|\\w+ cards) of your (?:own )?${zone}\\b`, "i");

function namesYourZone(text: string, zone: "library" | "hand" | "graveyard"): boolean {
  return YOURS(zone).test(text) && !NOT_YOURS(zone).test(text);
}

export function putsOwnCard(
  action: Pick<Action, "object" | "fromZone" | "verb">,
  zone: string | null | undefined,
  clauseActions: readonly Action[],
  source: Source,
  clauseText: string,
  cardText: string,
  granted: boolean,
): boolean {
  const object = (action.object ?? "").trim();
  switch (zone) {
    // `graveyardOwner` first (pointers, lists, "from your graveyard" in the object); then the plain words, for a stored object that dropped the zone ("up to two creature cards of the chosen type", Haunting Voyage) or states it as "of your
    // graveyard" (Shallow Grave) -- the clause names your graveyard and no other zone of that kind, as the library and hand reads below.
    case "graveyard": return graveyardOwner({ ...action, fromZone: "graveyard" }, clauseText, cardText, granted) === "you" || (!granted && (namesYourZone(object, "graveyard") || namesYourZone(clauseText, "graveyard")));
    case "library": return searchedLibraryOwner(clauseActions as Action[], clauseText) === "you" || namesYourZone(object, "library") || namesYourZone(clauseText, "library");
    case "hand": return namesYourZone(object, "hand") || namesYourZone(clauseText, "hand");
    case "exile": {
      if (source.to !== "action") return false;
      const from = clauseActions[source.action];
      if (from === undefined || from.verb !== "exile" || (from.fromZone !== "library" && from.fromZone !== "hand" && from.fromZone !== "graveyard")) return false;
      return namesYourZone(from.object ?? "", from.fromZone);
    }
    // A put the model stored with NO origin after a search of your library ("Search your library for a Mercenary ... and put it onto the battlefield", Bog Glider): the grammar reads `fromZone: library` there, the stored answer
    // leaves it out, and the two readings must AGREE on the owner or the card-by-card switch (derive-worker.ts `deriveDiff`) reads a new difference and flips the card to the stored answer (50 cards at #1737's first try).
    case undefined:
    case null: return clauseActions.some((a) => a.verb === "search" && a.fromZone === "library") && searchedLibraryOwner(clauseActions as Action[], clauseText) === "you";
    default: return false;
  }
}
