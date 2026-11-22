import type { Action } from "../canonicalize.js";
import { graveyardOwner } from "./graveyard-owner.js";
import { librarySearchOwner, printsSearch, searchedLibraryOwner } from "./library-search.js";
import type { Source } from "./references.js";

/** A PUT THE WORDS TAKE OUT OF YOUR OWN ZONE IS OF A CARD YOU OWN (#1737; CR 400.3: an object that would go to a library, graveyard or hand other than its owner's goes to its owner's, so each of those zones holds only
 *  its owner's cards; CR 108.3: a card's owner is the player who started the game with it in their deck). The `enters` emit then says `owner: you`, which "whenever a nonland permanent an opponent owns enters the battlefield under
 *  your control" (Brainstealer Dragon, `owner: opp`) refuses in the matcher (edges.ts `originMatches`): Primal Surge, Stitch Together, Revivify and every tutor-to-battlefield met it.
 *  The origin read is one of five, and only a zone the words call YOURS:
 *   - a graveyard: `graveyardOwner` (#1470), which reads "from your graveyard", a pointer back at "your graveyard" and a "your hand or graveyard" list, and refuses any graveyard that is not (only) yours. A POINTER ("it", "that card",
 *     a `ref: trigger` object) is read against the CLAUSE's own words only, never the card's whole text: Journey to Eternity's "When enchanted creature dies, return it ..." (a creature that can be stolen, so an opponent's card) is not licensed by
 *     the "your graveyard" of Atzal's back face. A pointer that names no zone in its own clause keeps no owner;
 *   - a library: the put's own preceding search says it is yours (`searchedLibraryOwner`, vetoed when THAT search is of "their" / an opponent's library: Tempt with Discovery's opponent put), or the put's object / the clause names
 *     "your library" and no other; a library put that names no library at all in its clause (See the Unwritten's Ferocious "two creature cards", the library of the clause before) takes the card's text when EVERY library the card names is yours;
 *   - a hand: "from your hand" and no other player's hand;
 *   - exile: the card the clause exiled FROM your library, hand or graveyard one action earlier (Primal Surge's "Exile the top card of your library ... put it onto the battlefield").
 *  `zone` is the ORIGIN the emit states: the stored answer's action says it (`fromZone`), the grammar's records leave it null and the emit's own `fromZone` is read off the object (Cryptic Gateway, Kastral), so both readings must stamp alike.
 *   - no origin at all: a put the model stored with no `fromZone` (Eldritch Evolution, Doubling Chant) after a search of your library in the same clause, which the grammar's own reading states as `fromZone: library`.
 *  CEILING: a put out of ANY graveyard ("a graveyard", Animate Dead, Reanimate), out of exile with no earlier exile of your own zone in the clause (a flicker, "cards exiled with this"), and a put the model stored with no origin
 *  and NO search of your library before it in the clause keep no owner: the card could be an opponent's, or the words do not say. "Return that card to the battlefield under its owner's control" after an exile of ANY creature (Long Road Home) keeps none too: its `control: any` is read
 *  by the matcher as possibly yours, though the card returns under its owner's control. A shared pile ("exiled with this permanent") is not read. */
const NOT_YOURS = (zone: string): RegExp => new RegExp(`\\b(?:opponents?['\\u2019]s?|players?['\\u2019]s?|their|that player['\\u2019]s|its owner['\\u2019]s|a|an|each|any|another|every|target player['\\u2019]s) ${zone}s?\\b`, "i");
const YOURS = (zone: string): RegExp => new RegExp(`\\b(?:from|in|of) your (?:own )?${zone}\\b|\\bthe top (?:card|\\w+ cards) of your (?:own )?${zone}\\b`, "i");

function namesYourZone(text: string, zone: "library" | "hand" | "graveyard"): boolean {
  return YOURS(zone).test(text) && !NOT_YOURS(zone).test(text);
}

/** The search a put follows, and whether THAT search is of another player's library: the clause's own printed words say it (`librarySearchOwner` with the search's place among the clause's searches), because the derived action's object has the
 *  zone words stripped ("a land card"). Undefined when the put follows no search. */
function precedingSearch(action: Action, clauseActions: readonly Action[], clauseText: string): { search: Action; other: boolean } | undefined {
  const at = clauseActions.indexOf(action);
  if (at < 0) return undefined;
  const before = clauseActions.slice(0, at);
  const idx = before.map((a) => a.verb).lastIndexOf("search");
  if (idx < 0) return undefined;
  const search = before[idx]!;
  const nth = before.slice(0, idx).filter((a) => a.verb === "search").length;
  const other = NOT_YOURS("library").test(search.object ?? "") || (clauseText !== "" && printsSearch(clauseText) && librarySearchOwner(search, clauseText, nth) === "other");
  return { search, other };
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
    case "graveyard": return graveyardOwner({ ...action, fromZone: "graveyard" }, clauseText, clauseText, granted) === "you" || (!granted && (namesYourZone(object, "graveyard") || namesYourZone(clauseText, "graveyard")));
    case "library": {
      // THE SEARCH THIS PUT FOLLOWS names whose library it is: "Each opponent may search their library ... and put it onto the battlefield" (Tempt with Discovery) is that opponent's land, the first and third puts are yours.
      if (precedingSearch(action as Action, clauseActions, clauseText)?.other === true) return false;
      if (searchedLibraryOwner(clauseActions as Action[], clauseText) === "you" || namesYourZone(object, "library") || namesYourZone(clauseText, "library")) return true;
      // A put that names no library in its own clause ("you may put two creature cards onto the battlefield instead of one", See the Unwritten's Ferocious): the card's text, when it names your library and no other.
      return clauseText !== "" && !/\blibrar(?:y|ies)\b/i.test(clauseText) && namesYourZone(cardText, "library");
    }
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
    case null: {
      const found = precedingSearch(action as Action, clauseActions, clauseText);
      return found !== undefined && found.search.fromZone === "library" && !found.other && searchedLibraryOwner(clauseActions as Action[], clauseText) === "you";
    }
    default: return false;
  }
}

/** A PUT OUT OF AN OPPONENT'S GRAVEYARD UNDER YOUR CONTROL IS A CARD AN OPPONENT OWNS ENTERING UNDER YOUR CONTROL (#1750; CR 400.3: a graveyard holds only its owner's cards, CR 108.3: the owner is the player whose deck it started in). Puppeteer Clique,
 *  Rakshasa Debaser, Bone Dancer, Tariel, Visions of Dread stored `control: opp` (the graveyard's owner) with no owner, so "a nonland permanent an opponent owns enters under your control" (Brainstealer Dragon, `control: you, owner: opp`) never heard them;
 *  Gruesome Encore, whose put is followed by an exile of it, was already stored `control: you, owner: opp` (derive.ts, #1502). The object itself names the graveyard ("an opponent's graveyard", "defending player's graveyard", "target opponent's graveyard",
 *  "your opponents' graveyards") and the clause says "under your control".
 *  CEILING: only that printed shape. A POINTER ("that card" after a creature an opponent controls died: Prince of Thralls, Necroskitter, Vraska the Silencer, Lim-Dul the Necromancer, The Reaper, Grave Betrayal: the creature can be yours, stolen, and then it is
 *  your own card) and a put out of "that player's graveyard" with no opponent named in the put's own object (Geth's Summons, Shark Shredder: stored `control: any`) and the pointers keep their stored control and no owner; a put out of an opponent's LIBRARY or exile (Bribery, Acquire) is stored `control: any`
 *  and meets the Dragon already. */
const OPPONENTS_YARD = /\b(?:opponents?['\u2019]s?|defending player['\u2019]s) graveyards?\b/i;
export function putsOpponentsCard(action: Pick<Action, "object" | "fromZone">, zone: string | null | undefined, clauseText: string): boolean {
  const object = (action.object ?? "").trim();
  return zone === "graveyard" && OPPONENTS_YARD.test(object) && !/\b(?:from|in) your (?:own )?graveyard\b/i.test(object) && /\bunder your control\b/.test(clauseText);
}
