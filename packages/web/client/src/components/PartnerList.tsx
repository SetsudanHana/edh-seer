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
export function PartnerList({ rows, pool, rarity, empty }: {
  rows: PartnerRow[];
  pool: Record<string, number>;
  rarity: Record<string, number>;
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

  // WIDTH BUYS COLUMNS, WHICH IS THE HOUSE RULE AND ALSO THE FIX FOR THE REAL COMPLAINT. MEASURED on
  // the deployed preview at 1440px: the partner rows used 640px of a 1440px viewport -- 44% -- with
  // the rest empty, because a reading measure sat on a list of INDEPENDENT groups. A group is a
  // self-contained unit (one event, up to three rows, one withheld count), so two of them side by
  // side is two facts, not a longer line. Native CSS columns with `break-inside-avoid`, the same
  // pattern the Overview blocks already use.
  return (
    <div className="flex flex-col gap-6 lg:block lg:columns-2 lg:gap-x-10 lg:space-y-6">
      {groups.map((group) => {
        const withheld = (pool[group.event] ?? group.rows.length) - group.rows.length;
        return (
          <section key={group.event} className="flex flex-col gap-3 break-inside-avoid">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-lg font-semibold tracking-[-0.01em]">
                {eventKeySentence(group.event)}
              </h3>
              {/* THE NUMBER THE ORDER IS ACTUALLY COMPUTED FROM. The page showed only the count of
                * cards that ASK for this event and ranked on how many can CAUSE it -- two different
                * populations. A skeptic reconstructed the ranking from the only figure on screen,
                * found it non-monotonic (2, 263, 1, 3, 1863, 15) and concluded the ranking was
                * broken; in THIS number the same groups read 72, 264, 2159, 2159, 2879, 2963,
                * descending exactly as the intro claims. Sound reasoning, missing evidence. */}
              {rarity[group.event] !== undefined && (
                <p className="text-(--muted) text-sm">
                  <span className="font-mono tabular-nums">
                    {rarity[group.event]!.toLocaleString("en-US")}
                  </span>{" "}
                  cards in the corpus can cause this — the rarer, the higher this pairing ranks.
                </p>
              )}
            </div>
            <ul className="flex flex-col">
              {group.rows.map((p) => (
                <li key={p.slug}
                  className="border-t border-(--separator) py-3 flex flex-col gap-1 first:border-t-0 first:pt-0">
                  <Link className="font-semibold text-(--accent) hover:underline underline-offset-2"
                    to={`/cards/${p.slug}`}>{p.name}</Link>
                  <p className="text-(--muted) max-w-[65ch]">{p.reason}</p>
                  {/* A LIMIT THE PAGE STATES IS HONEST; A LIMIT IT HIDES IS NOT. 3,453 consumer
                    * abilities carry no effect kind, so their sentence ends at "triggers" -- in the
                    * same typeface as the informative rows, which a skeptic called a refusal that
                    * reads as a hole. */}
                  {p.unread && (
                    <p className="eyebrow text-(--muted)">engine did not read what it does</p>
                  )}
                </li>
              ))}
            </ul>
            {withheld > 0 && (
              // COUNTED CANDIDATES, NOT VERIFIED EDGES, and the sentence has to say so: the engine
              // was never asked about the cards past the cap.
              // IT SAYS WHAT IS TRUE AND STOPS PROMISING WHAT IS NOT. "The page shows a few" read as
              // an announcement of hidden content with no way to reach it -- five dead ends per page,
              // and every reviewer stopped at one. There is no event-browse page to link to yet, so
              // this states the fact and names the reason rather than dangling a door.
              <p className="text-(--muted) text-sm">
                <span className="font-mono tabular-nums">{withheld.toLocaleString("en-US")}</span>{" "}
                other cards ask for it too, and they are equally specific — nothing here can rank one
                above another, so this shows a few rather than pretending to choose.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
