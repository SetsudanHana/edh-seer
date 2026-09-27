import { useMemo, useState } from "react";
import type { DeckReport } from "../types.js";
import { bracketWhy, infiniteCombos } from "../lib/bracket-why.js";
import { CardName } from "./card-drawer.js";
import { ComboLoop } from "./ComboLoop.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** WHICH TABLE THIS DECK IS FOR — WotC's official Commander Brackets, read off two published lists
 *  the engine already carries (roadmap L3).
 *
 *  IT DESCRIBES AND NEVER GRADES, and the copy has to carry that or a number between 1 and 5 reads
 *  as a score out of five sitting one panel away from two real scores out of five. A bracket 4 deck
 *  is not a worse deck than a bracket 2 deck; it is a deck for a different table, and the only
 *  useful thing to tell a reader is which contents put it there.
 *
 *  THREE BANDS, and the missing precision is stated rather than hidden: 1 vs 2 is about how the deck
 *  was BUILT and 4 vs 5 is a META judgement, neither of which is a checkable list.
 *
 *  AND IT DRAWS AS A BAND, NOT AS A NUMBER (roadmap S2, journey rule 7: a deck-relative dial and a
 *  WotC band must not read as the same scale). `Bracket 4-5` shipped as a 24px `stat-num` one
 *  column from SYNERGY and BUILD, both genuinely out of five -- so the one figure on this page that
 *  is NOT a score was the one wearing a score's clothes. Three cells cannot be read as "x out of
 *  5"; a big numeral can, and the sentence beside it was the only thing saying otherwise. */

/** The three bands, in the order WotC publishes them. A literal rather than derived from the union
 *  so the ORDER is stated once here instead of falling out of however `band` happens to be typed --
 *  the band's whole job is to put the deck somewhere on a line, and a line needs an order. */
const BANDS = ["1-2", "3", "4-5"] as const;

/** The band's cell labels use an EN DASH; the wire's `band` uses a hyphen, and they are different
 *  things: one is a range a reader sees, the other is a key the client joins on. */
const CELL_LABEL: Record<(typeof BANDS)[number], string> = { "1-2": "1–2", "3": "3", "4-5": "4–5" };

/** Rows of combos shown before "Show all": a deck with eleven would push the rest of the chapter a
 *  screen down, and the first few are the cheapest, which are the ones that decide the band. */
const COMBO_ROWS = 4;

export function BracketPanel({ bracket, combos, manaValueOf, artOf }: {
  bracket: DeckReport["bracket"];
  /** The report's full combo list: named here, not only counted. */
  combos?: DeckReport["combos"];
  manaValueOf?: (name: string) => number | undefined;
  /** A card's art, for the combo loops; without it the pieces are plain discs. */
  artOf?: (name: string) => string | undefined;
}) {
  const [allCombos, setAllCombos] = useState(false);
  // Without the full list (an older saved report), the cheap combos the bracket carries stand in.
  const listed = useMemo(() => !bracket ? [] : combos ? infiniteCombos(combos, manaValueOf ?? (() => undefined)) : bracket.cheapCombos.map((c) => ({ ...c, cheap: true })), [bracket, combos, manaValueOf]);
  if (!bracket) return null;
  const why = bracketWhy(bracket, combos ? listed : []);
  const shownCombos = allCombos ? listed : listed.slice(0, COMBO_ROWS);
  // ONE PIP PER PIECE OF EVIDENCE THE LIST BELOW NAMES, so the eye goes band -> why without
  // reading. Counted, never summed from `reasons`: that field is a second rendering of these same
  // facts and the panel already prints the more checkable one (named cards, per-combo rows).
  /** EVERY CHEAP COMBO IS ALREADY AN INFINITE ONE, so adding both counts each of them twice.
   *  `brackets.ts` derives `cheapCombos` by FILTERING `infinite` (two cards or fewer, mana value at
   *  or under `CHEAP_COMBO_MV`) — it is a subset by construction, never a separate set.
   *
   *  Measured on the example deck (S16, 2026-09-02): 1 Game Changer + 5 infinite combos, all five
   *  of them cheap, painted **11 pips over a list of six things**. A skeptic counted the list,
   *  found six, and could not reconcile it: *"eleven dots are painted, so the count is deliberate;
   *  nothing names the other five."* The count was simply wrong. */
  const pips = bracket.gameChangers.length + bracket.infiniteCombos;
  const split = bracket.band === "3" ? null : bracket.band === "1-2"
    ? "1 or 2 depends on whether this is a precon straight out of the box or one you've changed."
    : "4 or 5 depends on the table you take it to.";
  return (
    <div className="flex flex-col gap-3" data-testid="bracket-panel">
      <h3 className="eyebrow">Which table this is for</h3>
      {/* LESS IS MORE (owner, 2026-09-27: "we should rely more on data visualisation than the
        *  text"). The panel carried a definition per box, a paragraph on where each list comes from
        *  and a footnote per band. The band now names its own ends, the combos are drawn as loops,
        *  and the rest is one line at the foot. */}
      <div className="flex flex-col gap-1.5 max-w-md">
        {/* ONE TRACK, SEGMENTED -- not three pills: a band REPORTS, a tab strip INVITES. */}
        <div
          className="flex overflow-hidden rounded-(--radius) border border-(--separator)"
          role="img"
          aria-label={`Bracket ${bracket.band} of WotC's five Commander brackets, from 1, the most casual table, to 5, the most competitive`}
        >
          {BANDS.map((b, i) => {
            const here = b === bracket.band;
            return (
              <span
                key={b}
                data-testid="bracket-cell"
                data-here={here ? "1" : undefined}
                className={`flex-1 text-center stat-num text-sm py-1.5 ${i > 0 ? "border-l border-(--separator)" : ""} ${
                  // --fill, NOT --accent: a bracket is not an alert.
                  here ? "bg-(--fill) text-(--foreground)" : "text-(--muted)"
                }`}
              >
                {CELL_LABEL[b]}
              </span>
            );
          })}
        </div>
        {/* WHICH END IS WHICH, on the track itself rather than in a sentence under it. */}
        <div className="flex justify-between text-xs text-(--muted)" aria-hidden="true">
          <span>casual</span><span>competitive</span>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm">Bracket {CELL_LABEL[bracket.band]}</span>
          {/* THE PIPS CARRY A WORD, and the word does the addition out loud. */}
          {pips > 0 ? (
            <span className="flex items-baseline gap-1.5 text-xs text-(--muted)">
              <span className="flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: pips }, (_, i) => (
                  <span key={i} data-testid="bracket-pip" className="h-1.5 w-1.5 rounded-full bg-(--fill)" />
                ))}
              </span>
              {[
                bracket.gameChangers.length > 0 ? plural(bracket.gameChangers.length, "Game Changer") : null,
                bracket.infiniteCombos > 0 ? plural(bracket.infiniteCombos, "infinite combo") : null,
              ].filter(Boolean).join(", ")}
            </span>
          ) : null}
        </div>
        {/* WHY, IN ONE SENTENCE A PLAYER CAN SAY AT THE TABLE. */}
        <p data-testid="bracket-why" className="text-sm max-w-[65ch]">{why}</p>
      </div>

      {bracket.gameChangers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-(--muted)">{plural(bracket.gameChangers.length, "Game Changer")} · on Wizards&rsquo; list</span>
          <span className="flex flex-wrap gap-1">
            {bracket.gameChangers.map((n) => <span key={n} className="rounded-full border border-(--separator) px-2 py-0.5 text-xs"><CardName name={n} /></span>)}
          </span>
        </div>
      )}
      {listed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-(--muted)">{plural(bracket.infiniteCombos || listed.length, "infinite combo")} · each repeats without limit</span>
          <ul className="grid gap-2 lg:grid-cols-2 max-w-4xl" aria-label="The infinite combos in this deck">
            {shownCombos.map((c) => <ComboLoop key={c.cards.join("|")} cards={c.cards} result={c.result} manaValue={c.manaValue} cheap={c.cheap} artOf={artOf} />)}
          </ul>
          {listed.length > COMBO_ROWS ? (
            <button type="button" className="self-start min-h-9 text-xs text-(--accent) underline underline-offset-2" onClick={() => setAllCombos(!allCombos)}>
              {allCombos ? "Show fewer" : `Show all ${listed.length}`}
            </button>
          ) : null}
        </div>
      )}
      {/* A 4-5 DECK WITH NO CHEAP COMBO: the Game Changer count is what put it there. */}
      {bracket.band === "4-5" && bracket.cheapCombos.length === 0 && (
        <p className="text-xs text-(--muted) max-w-[65ch]">More Game Changers than bracket 3 allows is what puts this deck in 4–5.</p>
      )}
      {/* WHAT WAS LOOKED AT, WHOSE CALL EACH HALF IS, AND WHAT A LIST CANNOT SPLIT: one line. */}
      <p data-testid="bracket-checked" className="text-xs text-(--muted) max-w-[65ch]">
        {split ? <>{split} </> : null}
        Game Changers are Wizards&rsquo; list; the combos are Commander Spellbook&rsquo;s, and counting them is our call.
        Not checked: mass land destruction or chained extra turns.{" "}
        <a
          className="text-(--accent) underline underline-offset-2"
          href="https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta"
          target="_blank"
          rel="noreferrer noopener"
        >
          Wizards&rsquo; bracket guide
        </a>
      </p>
    </div>
  );
}
