import { useEffect, useState } from "react";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { Link } from "react-router";
import { groupDirection, searchHref, withheldFrom } from "../lib/inject.js";
import type { PartnerRow } from "../lib/partners.js";
import { CardTile } from "./CardTile.js";

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
/** A FEEDER ROW'S SENTENCE OPENS WITH THE ROW'S OWN NAME -- "While you control Guttersnipe, Krenko,
 *  Mob Boss counts it and makes more tokens" -- which under a tile that already shows Guttersnipe is
 *  the one half a two-line clamp should not spend itself on. The remainder names the page's card
 *  and what it does, which is the claim. Any other shape is kept whole. */
function feederCaption(p: PartnerRow, subject?: string): string {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The page's own card leads the second half too -- "Krenko, Mob Boss counts it and makes more
  // tokens" -- and under a two-line clamp at phone width that name was all that survived (phone
  // review, 2026-09-17). The page already says whose page it is.
  const lead = new RegExp(`^While you control ${esc(p.name)},\\s*(?:${subject ? esc(subject) + "\\s+" : ""})?`, "i");
  return p.reason.replace(lead, "");
}

/** Tiles in one row below `sm`, where the grid is `grid-cols-3`. */
const PHONE_ROW = 3;

export function PartnerList({ rows, pool, rarity, empty, subject, identity }: {
  rows: PartnerRow[];
  /** The page's own card, so a feeder caption can leave its name out. */
  subject?: string;
  /** THE DECK'S COLOURS, on a commander page only. The withheld count is scoped to them (AJ5), so
   *  the link under it has to be scoped the same way or it opens a corpus-wide set under a
   *  commander-sized number. A card page passes nothing: there is no deck there. */
  identity?: readonly string[];
  pool: Record<string, number>;
  rarity: Record<string, number>;
  empty: string;
}) {
  // ONE ROW PER GROUP ON A PHONE (UX review, 2026-09-17: 9.6 screens, Partners at 1,335px). Three
  // tiles is the row below `sm`; the rest stay in the document and hide by CSS until the group is
  // asked for, so nothing here knows the viewport and a wide screen never sees the button.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // A new list is a new page; what was unfolded on the last one does not carry over.
  useEffect(() => { setOpened(new Set()); }, [rows]);
  if (rows.length === 0) {
    return <p className="text-(--muted) max-w-[65ch]">{empty}</p>;
  }

  // Grouped BY EVENT in the order each event first arrives, which is specificity order -- the
  // most precisely matched event leads the page. By key and not by adjacency: two events can share
  // a score and interleave under the stable sort, and adjacency split one group in two.
  const groups: { event: string; rows: PartnerRow[] }[] = [];
  for (const row of rows) {
    const g = groups.find((x) => x.event === row.event);
    if (g) g.rows.push(row);
    else groups.push({ event: row.event, rows: [row] });
  }

  // GROUPS STACK FULL WIDTH (2026-09-17). Two side-by-side columns made sense for rows of text;
  // for tiles they halved the tile to ~105px. One group per band, five tiles across on a wide
  // viewport, is the shape EDHREC readers already know.
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        // THE SAME DIRECTION DECIDES THE COUNTER AND THE VERB (2026-09-19). This read `pool` for
        // every group and then printed "cause it" under producer rows -- the sentence named one
        // direction and the number came from the other. `withheldFrom` is shared with the
        // prerendered block so the two readers cannot drift again.
        const dir = groupDirection(group.rows);
        const withheld = withheldFrom(dir, group.event, group.rows.length, rarity, pool);
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
                  <span className="inline-flex items-baseline gap-1 rounded-full border border-(--separator) px-2 py-0.5">
                    <span className="font-mono tabular-nums text-(--foreground)">
                      {rarity[group.event]!.toLocaleString("en-US")}
                    </span>
                    cards can cause this
                  </span>
                </p>
              )}
            </div>
            {/* TILES, NOT ROWS (owner, 2026-09-17: "just a wall of text"). Each row is the whole card
              * small, the name, its pips and the payoff clamped to two lines; the engine's full
              * sentence is still in the artifact and still what the deck report prints. A feeder
              * row has no payoff (its sentence describes the subject, not this card) and shows the
              * sentence whole. The click rule lives in `CardTile`. */}
            <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-3 gap-y-5 sm:gap-x-4 list-none p-0 m-0">
              {group.rows.map((p, i) => (
                <li key={p.slug} className={i >= PHONE_ROW && !opened.has(group.event) ? "min-w-0 max-sm:hidden" : "min-w-0"}>
                  <CardTile
                    slug={p.slug} name={p.name} art={p.art} identity={p.identity}
                    // AN UNREAD ROW HAS NO PAYOFF TO SHOW. Its "triggers" over the limit read as the
                    // payoff with a footnote (UX review, 2026-09-17); the limit is the whole caption.
                    // A PRODUCER ROW SAYS ITS DIRECTION AND NOTHING ELSE (2026-09-17): its sentence's
                    // tail is this page's own card, and its head is the group heading.
                    caption={p.unread || p.producer ? undefined : p.payoff ?? feederCaption(p, subject)}
                    note={p.producer ? "causes it" : p.unread ? "engine did not read what it does" : undefined}
                  />
                </li>
              ))}
            </ul>
            {group.rows.length > PHONE_ROW && !opened.has(group.event) && (
              <button
                type="button"
                className="btn-secondary self-start sm:hidden"
                onClick={() => setOpened((s) => new Set(s).add(group.event))}
              >
                Show {group.rows.length - PHONE_ROW} more
              </button>
            )}
            {withheld > 0 && (
              // COUNTED CANDIDATES, NOT VERIFIED EDGES, and the sentence has to say so: the engine
              // was never asked about the cards past the cap. Equal members are ordered by partner
              // count since 2026-09-17 (owner ruling; `degreeOf` in partners-core, replacing a
              // play-rate tie-break refused as stale), so the ones shown are the best connected,
              // and the sentence says that instead of the older "nothing here can rank one above
              // another", which stopped being true.
              // AND THE COUNT IS A LINK (roadmap AJ3). The set it opens is the one this number
              // counted: a producer group asks `produce`, an asker group asks `consume`, and a
              // commander page carries its own colours so the page lands on the cards its deck
              // could actually play. A link to a superset would be AJ1 again, with a URL.
              <p className="text-(--muted) text-sm">
                <Link to={searchHref(dir, group.event, identity)} className="underline">
                <span className="font-mono tabular-nums">{withheld.toLocaleString("en-US")}</span>{" "}
                {/* A FEEDER GROUP RUNS THE OTHER WAY (skeptic review, 2026-09-17): its tiles are cards
                  * this card counts, so "ask for it" named the wrong direction under them. A feeder
                  * row is the one whose sentence opens on the row's card being controlled. */}
                {dir === "causes"
                  ? "other cards cause it too, equally specific. The ones shown are the best connected."
                  : dir === "feeds"
                  ? "other cards feed it too, equally specific. The ones shown are the best connected."
                  : "other cards ask for it too, equally specific. The ones shown are the best connected."}
                </Link>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
