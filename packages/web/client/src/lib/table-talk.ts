import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";
import type { CardGraph, DeckReport } from "../types.js";
import { infiniteCombos } from "./bracket-why.js";
import { fastestRoute, speedRoutes } from "./speed.js";

/** WHAT TO SAY AT THE TABLE, IN ONE BREATH (owner, 2026-09-26: the phone and one-line answer is a
 *  UX problem "to be addressed"). The baseline round's phone seat assembled its sentence from four
 *  screens (1, 2, 4 and 15); r/EDH's rule-zero advice is to say the bracket, how the deck wins, how
 *  fast, and anything a stranger would want warning of. Every clause here is a JOIN over what the
 *  report's own chapters already show, so the line and the chapters cannot disagree:
 *  - the bracket and the cards that put it there (`bracket.gameChangers`, the cheapest infinite
 *    combo, as the Bracket panel names them);
 *  - the main win plan (`deckMath.wincons`, in the Win plans panel's words);
 *  - the fastest timed route (`speedRoutes`, the speed panel's own headline);
 *  - the heads-up: extra turns, stealing, destroying every land, an infinite combo, read off the
 *    cards' printed text, named, and said to be absent when they are. */

export interface HeadsUp { key: "extra-turns" | "steal" | "land-destruction" | "infinite"; says: string; cards: string[] }

export interface TableTalk {
  /** The whole line, as it would be copied. */
  text: string;
  bracket: string;
  plan?: string;
  headsUp: HeadsUp[];
}

const WARN: { key: HeadsUp["key"]; says: string; test: RegExp }[] = [
  { key: "extra-turns", says: "takes extra turns", test: /\btakes? an extra turn\b|\bextra turns? after this one\b/i },
  { key: "steal", says: "steals permanents", test: /\bgain control of\b(?![^.]*\byou own\b)|\byou control enchanted (?:creature|permanent|artifact|land|planeswalker)\b|\bexchange control of\b/i },
  { key: "land-destruction", says: "can destroy every land", test: /\b(?:destroy|exile) all (?:nonbasic )?lands\b|\bsacrifices? all lands\b|\beach player sacrifices [^.]{0,20}lands\b/i },
];

/** What the table would be warned about in this text ("steals permanents"), by the same patterns the
 *  heads-up reads, so the cut list can say a warned-about card is one (#982). */
export function warnsAbout(text: string): string[] {
  return WARN.filter((w) => w.test.test(text)).map((w) => w.says);
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const front = (name: string) => name.split(" // ")[0]!;

export function tableTalk(report: DeckReport, graph: CardGraph | undefined, manaValueOf: (name: string) => number | undefined): TableTalk | null {
  const b = report.bracket;
  if (!b) return null;
  const band = b.band === "1-2" ? "1–2" : b.band === "4-5" ? "4–5" : "3";
  const combos = infiniteCombos(report.combos, manaValueOf);
  const why: string[] = [];
  if (b.gameChangers.length) why.push(b.gameChangers.length <= 2 ? `${list(b.gameChangers.map(front))} (${b.gameChangers.length === 1 ? "a Game Changer" : "Game Changers"})` : `${b.gameChangers.length} Game Changers`);
  const cheap = combos.find((c) => c.cheap);
  if (cheap) why.push(`a cheap two-card combo (${cheap.cards.map(front).join(" + ")})`);
  // A COMBO BRACKET 3 STILL ALLOWS is still the thing a stranger asks about: named here, and then
  // not a second time in the heads-up.
  const allowed = !cheap && combos[0] ? combos[0] : undefined;
  if (allowed) why.push(`an infinite combo that ${allowed.cards.length > 2 ? `needs ${allowed.cards.length} cards` : "comes together late"} (${allowed.cards.map(front).join(" + ")})`);
  const bracket = `Bracket ${band}${why.length ? `, for ${list(why)}` : b.band === "1-2" ? ": no Game Changers and no infinite combo" : ""}.`;

  const classes = report.deckMath?.wincons.classes ?? [];
  const primary = classes[0];
  const second = classes[1];
  const fastest = fastestRoute(speedRoutes(report, manaValueOf));
  // "MOSTLY" ONLY WHEN THE DECK LEANS (persona round 2026-09-27: "It wins mostly by …" beside How
  // you win's "Spread about evenly across 4 plans"). The lean test is the one `WinPlans` prints.
  const focus = report.deckMath?.wincons.focus ?? 1;
  const leans = classes.length <= 1 || focus >= 1 / classes.length + 0.15;
  const phrase = (c: { class: string }) => WIN_PHRASE[c.class] ?? c.class;
  const plan = primary
    ? (leans
      ? `It wins mostly by ${phrase(primary)}${second ? `, or ${phrase(second)}` : ""}`
      : `It spreads its wins across ${classes.length} plans: ${list([...classes.slice(0, 3).map(phrase), ...(classes.length > 3 ? [`${classes.length - 3} more`] : [])])}`)
      + (fastest?.turn === undefined ? ""
        : fastest.kind === "combo" ? `, and can combo as early as turn ${fastest.turn}`
        : `, and its creatures can kill one opponent around turn ${fastest.turn}`)
      + "."
    : undefined;

  const headsUp: HeadsUp[] = [];
  for (const w of WARN) {
    const cards: string[] = [];
    for (const n of graph?.nodes ?? []) {
      if (n.isToken || n.isEmblem || (n.face ?? 0) > 0) continue;
      const name = n.cardName ?? n.id;
      const text = n.oracleText ?? n.faces?.map((f) => f.oracleText ?? "").join("\n") ?? "";
      if (w.test.test(text) && !cards.includes(name)) cards.push(name);
    }
    if (cards.length) headsUp.push({ key: w.key, says: w.says, cards });
  }
  // Already named in the bracket clause: the heads-up says it once, not twice.
  if (combos.length && !cheap && !allowed) headsUp.push({ key: "infinite", says: "has an infinite combo", cards: combos[0]!.cards });

  const named = (h: HeadsUp) => `${h.says} (${h.key === "infinite" ? h.cards.map(front).join(" + ") : list(h.cards.slice(0, 2).map(front))}${h.key !== "infinite" && h.cards.length > 2 ? ` and ${h.cards.length - 2} more` : ""})`;
  // HONEST IN BOTH DIRECTIONS: "nothing to warn about" is a claim a stranger can rely on, so it is
  // said, and said as what was checked.
  const warn = headsUp.length
    ? `Heads-up: it ${list(headsUp.map(named))}.`
    : combos.length
      ? "Beyond that combo, nothing in it takes extra turns, steals or destroys every land."
      : "Nothing in it takes extra turns, steals, destroys every land or goes infinite.";
  return { text: [bracket, plan, warn].filter(Boolean).join(" "), bracket, ...(plan ? { plan } : {}), headsUp };
}
