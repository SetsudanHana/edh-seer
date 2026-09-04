import { Link } from "react-router";
import { eventKeySentence } from "../lib/demand-sentence.js";
import type { PartnerRow } from "../lib/partners.js";

/** THE PARTNER LIST, GROUPED BY THE EVENT THAT EARNED EACH ROW.
 *
 *  A FLAT LIST WAS THE WRONG SHAPE FOR THIS DATA. `PER_EVENT_CAP` gives each event at most three
 *  rows, and those three carry near-identical sentences by construction -- "When a Goblin enters
 *  thanks to Krenko, X triggers" three times over. Read as one list that is repetition; read under
 *  the event they share it is one fact with three examples, which is what the cap was designed to
 *  produce in the first place.
 *
 *  It also puts the withheld count where it belongs. "And 1,906 more cards trigger on this" used to
 *  sit at the bottom of the page, detached from the rows it was about; it now closes the group it
 *  describes.
 *
 *  NO SCORES. The specificity number decides the ORDER and never appears: on a reading surface the
 *  reason sentence is the atomic unit (DESIGN.md, the graph doc's ban on scores), and a 0.233 beside
 *  a sentence invites a reader to compare two numbers whose scale nothing on the page explains. */
export function PartnerList({ rows, pool, empty }: {
  rows: PartnerRow[];
  pool: Record<string, number>;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-(--muted) max-w-[65ch]">{empty}</p>;
  }

  // Grouped in the order the rows arrive, which is already specificity order -- the most precisely
  // matched event leads the page.
  const groups: { event: string; rows: PartnerRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.event === row.event) last.rows.push(row);
    else groups.push({ event: row.event, rows: [row] });
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const withheld = (pool[group.event] ?? group.rows.length) - group.rows.length;
        return (
          <section key={group.event} className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold tracking-[-0.01em]">
              {eventKeySentence(group.event)}
            </h3>
            <ul className="flex flex-col">
              {group.rows.map((p) => (
                <li key={p.slug}
                  className="border-t border-(--separator) py-3 flex flex-col gap-1 first:border-t-0 first:pt-0">
                  <Link className="font-semibold text-(--accent) hover:underline underline-offset-2"
                    to={`/cards/${p.slug}`}>{p.name}</Link>
                  <p className="text-(--muted) max-w-[65ch]">{p.reason}</p>
                </li>
              ))}
            </ul>
            {withheld > 0 && (
              // COUNTED CANDIDATES, NOT VERIFIED EDGES, and the sentence has to say so: the engine
              // was never asked about the cards past the cap.
              <p className="text-(--muted) text-sm">
                <span className="font-mono tabular-nums">{withheld.toLocaleString("en-US")}</span>{" "}
                more cards ask for this. They are equally specific, so the page shows a few.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
