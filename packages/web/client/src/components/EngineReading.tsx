import { effectPhrase, type AbilityRow } from "@edh-seer/matcher/partners-core";
import { eventKeyAction, eventKeyClause, eventKeySentence } from "../lib/demand-sentence.js";
import { groupAnchor } from "../lib/group-anchor.js";
import { ManaText } from "./ManaSymbols.js";
import { isLoyaltyCost, LoyaltyCost } from "./LoyaltyCost.js";
import { useFace } from "./face.js";

/** THE CARD, READ DOWN THE CARD (roadmap AJ4, spec C1). One section replacing two.
 *
 *  WHAT IT REPLACES, AND WHY THEY HAD TO GO. `What the engine read` was the clause list and `How
 *  the engine reads this card` was the derived abilities -- two headings that sound identical,
 *  stacked on top of each other on a phone (measured at 390px: y=1361 and y=1601), with nothing on
 *  either saying why there were two. The clause block also duplicated the card image beside it.
 *
 *  THE CLAUSE IS THE SPINE. Each printed line carries the abilities it derived and the events
 *  those produce or consume, and each event jumps to the partner group already on the page. That
 *  is the product's whole claim end to end: this line of this card, this event, these cards.
 *
 *  ATTRIBUTION IS BY ID, NEVER BY POSITION (spec C2). `segment` numbers clauses from 1 and DERIVE
 *  164 stamps that number onto every ability the clause produces. A positional zip looks plausible
 *  and lies on every row of any card whose first clause derives nothing -- Samut has 4 clauses and
 *  3 abilities -- and the shipped clause list drops empty segments, so position is not even stable.
 *
 *  A CLAUSE THAT DERIVES NOTHING SAYS NOTHING (spec C3, owner ruling). Being listed IS the
 *  statement that the engine read it; the absence of event rows is the statement that it produces
 *  and consumes nothing right now. No copy, because any wording editorialises on a keyword line
 *  where the absence is simply true, and would need rewriting every time the vocabulary grows. */
const KIND_LABEL: Record<string, string> = {
  triggered: "triggered",
  activated: "activated",
  static: "static",
  "on-cast": "on cast",
};

/** An emit is what the ability DOES, so it takes the action form; a trigger is what it WAITS for,
 *  so it takes the clause. A self trigger names the card, which only the clause can say. */
const emitPhrase = (key: string, self?: boolean): string =>
  self === true ? eventKeyClause(key, "this card") : eventKeyAction(key) ?? eventKeyClause(key);

export interface EngineReadingProps {
  clauses?: { id: number; text: string; face?: number }[];
  abilities: AbilityRow[];
  /** How many cards can cause each event, keyed as the partner rows are. The count a row prints. */
  rarity?: Record<string, number>;
  /** The events that have a group rendered on this page, so a row only links where a target
   *  exists -- an anchor to nothing is worse than no anchor. */
  grouped?: ReadonlySet<string>;
  /** The caller already wrote the heading -- the phone disclosure's summary IS it, and the rail
   *  carries a label rather than a heading so a screen reader's heading list stays the page's. */
  headless?: boolean;
}

export function EngineReading({ clauses, abilities: allAbilities, rarity, grouped, headless }: EngineReadingProps) {
  // THE FACE ON VIEW, the way the ability table did it: under a `FaceContext` only the showing
  // face's clauses and abilities render, with a line naming it, so the reading turns with the
  // picture. Filtering the abilities alone would leave a back-face clause standing bare, which
  // reads as "this line derives nothing" about a line the reader cannot see.
  const view = useFace();
  const twoFaced = allAbilities.some((r) => r.face !== undefined) || (clauses ?? []).some((c) => c.face !== undefined);
  const abilities = view && twoFaced ? allAbilities.filter((r) => (r.face ?? 0) === view.face) : allAbilities;
  const shown = view && twoFaced ? (clauses ?? []).filter((c) => (c.face ?? 0) === view.face) : clauses ?? [];
  const faceNote = view && twoFaced
    ? <p className="text-(--muted) text-sm">{view.names[view.face] ?? `face ${view.face + 1}`} · flip the card for the other face</p>
    : null;
  // NO EARLY RETURN ON AN EMPTY CARD: the "read nothing" line below is the W10 statement, and a
  // card with neither clauses nor abilities is exactly the case it exists for.
  const byClause = (id: number): AbilityRow[] => abilities.filter((a) => a.clause === id);
  // AN IMPLIED ABILITY HAS NO PRINTED LINE (spec C4): it is read off the card's characteristics --
  // a keyword body, a token's own line -- so it goes at the end with no quote above it. Measured
  // 2026-09-19: 226 of 54,586 rows corpus-wide, 0.4%.
  const implied = abilities.filter((a) => a.clause === undefined);

  return (
    <section className="flex flex-col gap-4 max-w-[68ch]">
      {headless !== true && (
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-[-0.01em]">How the engine reads this card</h2>
          <p className="text-(--muted) text-sm">The card&rsquo;s own lines, and what each one produces or waits for.</p>
        </div>
      )}
      {faceNote}
      <ol className="flex flex-col gap-4 list-none p-0 m-0">
        {shown.map((c) => (
          <li key={c.id} className="flex flex-col gap-2">
            {/* THE CLAUSE AT FULL STRENGTH, the abilities under it quieter: on a vanilla creature
              * every clause renders bare, and a list of clauses with no events has to read as
              * "nothing to claim here" rather than as a page that failed to load. */}
            <blockquote className="border-l-2 border-(--separator) pl-3"><ManaText text={c.text} /></blockquote>
            {byClause(c.id).map((a, i) => (
              <AbilityLines key={i} row={a} rarity={rarity} grouped={grouped} />
            ))}
          </li>
        ))}
        {implied.length > 0 && (
          <li className="flex flex-col gap-2">
            <p className="eyebrow text-(--muted)">read off the card itself</p>
            {implied.map((a, i) => <AbilityLines key={i} row={a} rarity={rarity} grouped={grouped} />)}
          </li>
        )}
      </ol>
      {/* THE CARD-LEVEL EMPTY STATE STAYS (roadmap W10): an empty reading is where a wrong "no
        * ability" can be seen at all -- 117 derived commanders carried zero abilities. C3 bans
        * copy under an individual CLAUSE, which is a different statement: there the absence of
        * event rows says it, and a keyword line genuinely produces nothing. */}
      {abilities.length === 0 && (
        <p className="text-(--muted)">The engine read nothing on this card.</p>
      )}
    </section>
  );
}

function AbilityLines({ row, rarity, grouped }: { row: AbilityRow; rarity?: Record<string, number>; grouped?: ReadonlySet<string> }) {
  const does = effectPhrase(row.effect, row.amount, row.effectSelf ? "itself" : undefined, row.recipient)
    ?? row.effect.replace(/-/g, " ");
  return (
    <div className="flex flex-col gap-1 pl-3">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="eyebrow text-(--muted)">{KIND_LABEL[row.kind] ?? row.kind}</span>
        {/* A LOYALTY COST IS THE PRINTED BADGE, EVERY OTHER COST IS ITS SYMBOLS. AJ4 replaced
          * `AbilityTable` here and the badge did not come with it, so a planeswalker's "+1" read as
          * bare monospace on the card page while the rail's peek still drew it (owner, 2026-09-20). */}
        {row.cost && (isLoyaltyCost(row.cost)
          // SIZED FOR A SENTENCE, NOT FOR THE TABLE IT WAS DRAWN FOR. The badge is `2.4em`, chosen
          // in a stacked `AbilityTable` row where it had the column to itself; inline on this line
          // it stands a full text-line above its own baseline and reads as a mark on the row above.
          // `text-xs` scales it against this row rather than capping it in px, so it still grows
          // with the reader's font size. Measured in the browser: 2.4em of 12px is a 29px badge
          // with a 13px digit beside 16px text -- the digit readable, the badge on the line. The
          // first cut of this was `text-[0.5em]`, which put the badge on the line and made the
          // sign unreadable, which is the same defect the other way round.
          ? <span className="text-xs leading-none self-center"><LoyaltyCost cost={row.cost} /></span>
          : <span className="font-mono text-sm"><ManaText text={row.cost} /></span>)}
        <span>{does}</span>
      </p>
      {/* WHAT IT WAITS FOR, then WHAT IT PUTS INTO THE GAME -- the two directions the whole engine
        * is built on, in the reader's own words, each jumping to the cards on the other side. */}
      {/* "WANTS" TAKES THE NOUN FORM, not the clause: the label is a verb, so the words after it
        * have to be a thing. "wants life being lost" reads; "wants life is lost" does not. The
        * static rows already read this way because their label form is a noun phrase. */}
      {row.when.map((key) => (
        <EventRow key={`w${key}`} label="wants" text={eventKeySentence(key, row.self ? "this card" : undefined, row.whenColors)}
          event={key} count={rarity?.[key]} grouped={grouped} />
      ))}
      {/* A STATIC DEMANDS BY REACH, not by trigger: the anthem wants the creatures it boosts. */}
      {(row.applies ?? []).map((key) => (
        <EventRow key={`a${key}`} label="wants" text={eventKeySentence(key)}
          event={key} count={rarity?.[key]} grouped={grouped} />
      ))}
      {row.emits.map((key) => (
        <EventRow key={`e${key}`} label="makes" text={emitPhrase(key, row.selfEmits?.includes(key))}
          event={key} count={rarity?.[key]} grouped={grouped} />
      ))}
    </div>
  );
}

function EventRow({ label, text, event, count, grouped }: {
  label: string; text: string; event: string; count?: number; grouped?: ReadonlySet<string>;
}) {
  const body = (
    <>
      <span className="eyebrow text-(--muted)">{label}</span>{" "}
      <span>{text}</span>
      {count !== undefined && (
        <span className="text-(--muted) text-sm"> · <span className="font-mono tabular-nums">{count.toLocaleString("en-US")}</span> cards</span>
      )}
    </>
  );
  // A LINK ONLY WHERE THE GROUP EXISTS. An anchor that lands nowhere is worse than plain text, and
  // a card's ability often names an event no partner on this page was found for.
  return grouped?.has(event) === true
    ? <p><a className="underline" href={`#${groupAnchor(event)}`}>{body}</a></p>
    : <p>{body}</p>;
}
