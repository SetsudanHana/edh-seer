/** WHOSE LIBRARY A MILL EMPTIES (#1663; matcher side: `matcher/src/mill-scope.ts`). A mill is the one effect whose player the matcher routes on (`you` is a self-mill, `opp` a win route, `any` either), and its player is
 *  written in three different places: the object of a `mill` verb ("that creature's controller"), the library a PUT names ("the top two cards of your library ... put one of them into your graveyard"), and, for a
 *  replacement, the sentence's actor ("if an opponent would mill"). The generic readers left each of them `any` or `you`; this reads them the way the printed words do.
 *
 *  CEILING: the possessive of a library is the only owner read for a put, and the object of a `mill` verb the only other; "its owner's library" and a library that no earlier action or the clause names stay with the
 *  generic reading. "that player" is an opponent only where `thatPlayerIsOpponent` can prove it (an opponent named earlier, or the card's own combat damage), else it is left as it was.
 */
import type { Action } from "../canonicalize.js";
import type { Control } from "../schema.js";
import { isControllerPhrase } from "./damage-recipient.js";
import { millsOwnLibrary } from "./emits.js";
import { thatPlayerIsOpponent } from "./recipient.js";

const LIBRARY = /\b(your|target opponent's|an opponent's|each opponent's|target player's|each player's|a player's|any player's|that player's|their) librar(?:y|ies)\b/i;
const PLAYER_BEFORE = /\b(target opponent|an opponent|each opponent|target player|each player|that player|enchanted player)\b/gi;
/** "The controller of a creature that attacks you" is an opponent: nothing attacks its own controller (the fact `controlFromRelation` reads for "attacking you"). */
/** "that player mills a card" / "that player loses 1 life and mills a card": the player is the miller. Not across a comma ("If that player doesn't, you mill X cards", Palantir of Orthanc: the miller is you). */
const THAT_PLAYER_MILLS = /\bthat (?:player|opponent) (?:[^.;,]{0,60}\band )?mills?\b/i;
const ATTACKS_YOU = /\battacks? you\b/i;

export interface MillOwnerCtx { clauseText: string; cardText: string; triggerSelf: boolean; cardName?: string }

function ownerOfPlayerPhrase(phrase: string, ctx: MillOwnerCtx, text: string): Control | undefined {
  const p = phrase.toLowerCase();
  if (p === "your") return "you";
  if (p.includes("opponent")) return "opp";
  if (/^(?:target|each|a|any) player(?:'s)?$/.test(p) || p === "enchanted player") return "any";
  if (p === "that player" || p === "that player's") return thatPlayerIsOpponent(text, ctx.triggerSelf, ctx.cardName) ? "opp" : undefined;
  return undefined;
}

/** The owner a library phrase names (`m` is a `LIBRARY` match inside `full`). "their library" belongs to the last player `full` named before it. */
function libraryOwner(m: RegExpExecArray, full: string, ctx: MillOwnerCtx): Control | undefined {
  const who = m[1]!.toLowerCase();
  if (who !== "their") return ownerOfPlayerPhrase(who, ctx, ctx.clauseText.trim() !== "" ? ctx.clauseText : full);
  let last: string | undefined;
  for (const x of full.slice(0, m.index).toLowerCase().matchAll(PLAYER_BEFORE)) last = x[1];
  return last === undefined ? undefined : ownerOfPlayerPhrase(last, ctx, full);
}

/** The owner of each library a text names, in printed order. */
function libraryOwners(full: string, ctx: MillOwnerCtx): (Control | undefined)[] {
  return [...full.matchAll(new RegExp(LIBRARY.source, "gi"))].map((m) => libraryOwner(m as RegExpExecArray, full, ctx));
}

/** The one owner EVERY library a text names has, or undefined when it names none, one the words do not resolve, or two different owners. */
function soleLibraryOwner(full: string, ctx: MillOwnerCtx): Control | undefined {
  const owners = new Set(libraryOwners(full, ctx));
  return owners.size === 1 ? [...owners][0] : undefined;
}

/** A library->graveyard put's own place among the clause's such puts. */
const isLibraryPut = (a: Action): boolean => a.verb === "put" && a.toZone === "graveyard" && a.fromZone === "library";

/** The control of the library the mill at `actions[idx]` empties, or undefined when the words do not say (the generic reading stands). */
export function milledLibraryOwner(actions: readonly Action[], idx: number, ctx: MillOwnerCtx): Control | undefined {
  const action = actions[idx]!;
  const object = (action.object ?? "").trim();
  if (action.verb === "mill") {
    // "that creature's controller mills" after "a creature attacks you": an opponent (Riddlekeeper).
    if (isControllerPhrase(object) && ATTACKS_YOU.test(ctx.clauseText)) return "opp";
    // "that player mills" after the card's own combat damage, or after a named opponent (Krydle, Mirko Vosk).
    // The grammar path's object is the count ("a card"); the player is the clause's own "that player ... mills".
    if (/^that (?:player|opponent)$/i.test(object) || THAT_PLAYER_MILLS.test(ctx.clauseText)) return thatPlayerIsOpponent(ctx.clauseText, ctx.triggerSelf, ctx.cardName) ? "opp" : undefined;
    return undefined;
  }
  if (action.verb !== "put" || action.toZone !== "graveyard") return undefined;
  // THE LIBRARY THE PUT'S OWN WORDS NAME, else the nearest earlier action's ("the top three cards of target opponent's library ... puts the rest into their graveyard"; "You do the same with the top three cards of your library").
  for (let i = idx; i >= 0; i--) {
    const o = actions[i]!.object ?? "";
    const m = LIBRARY.exec(o);
    if (!m) continue;
    if (m[1]!.toLowerCase() !== "their") return libraryOwner(m, o, ctx);
    // "their library" in an action's object is the player the CLAUSE named before THIS occurrence (Guild Feud names "their library" and "your library"), so it is read where the object sits in the clause.
    const at = ctx.clauseText.toLowerCase().indexOf(o.toLowerCase());
    if (at < 0) return soleLibraryOwner(ctx.clauseText, ctx);
    const here = Object.assign([...m], { index: at + m.index, input: ctx.clauseText }) as RegExpExecArray;
    return libraryOwner(here, ctx.clauseText, ctx);
  }
  // No action names a library: the libraries the clause's own words name, or the card's when the stored record has no text of its own (Gathering Stone's second record, Celestus Sanctifier's twin).
  // CEILING: every library the text names must have ONE owner; a clause that mills both players' (and names no reveal per action) keeps the generic reading.
  const text = ctx.clauseText.trim() !== "" ? ctx.clauseText : ctx.cardText;
  // THE Nth LIBRARY PUT READS THE Nth LIBRARY OF THE TEXT, in printed order, when there are as many of each (Guild Feud: "target opponent reveals the top three cards of their library ... puts the rest into their graveyard. You do the same with the top three cards of your library"; the canonical form has dropped the reveals, so no action names a library).
  // CEILING: positional; a text whose library count differs from its library-put count (a library named by a search or a look) falls back to the one-owner rule.
  if (isLibraryPut(action)) {
    const puts = actions.filter(isLibraryPut);
    const owners = libraryOwners(text, ctx);
    const nth = puts.indexOf(action);
    if (puts.length >= 2 && owners.length === puts.length && nth >= 0) return owners[nth];
  }
  return soleLibraryOwner(text, ctx) ?? (millsOwnLibrary(action, text) ? "you" : undefined);
}
