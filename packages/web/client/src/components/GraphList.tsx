import { useMemo, useState } from "react";
import type { CardGraph } from "../types.js";
import { CardName } from "./card-drawer.js";
import { hatchImage } from "../lib/unread.js";

/** THE GRAPH'S DATA WITHOUT THE GRAPH, for a screen the board cannot use.
 *
 *  At 390px the canvas is ~324×378 with a three-line chip row above it, pan and zoom fight the
 *  page's own scroll on the same axis, and the inspector opens near-fullscreen over the board with
 *  its close button off screen. The LAYOUT is what fails there — 95 discs in a phone-width box
 *  carry no readable position — while the DATA behind it (who feeds whom, and the reason sentence
 *  for each edge) delivers perfectly well as a list.
 *
 *  So this is not a fallback with less in it: every card and every edge is reachable, ranked by how
 *  connected each card is, and a tap opens the same `CardInspector` the board opens, through the
 *  drawer that already exists for the rest of the report.
 *  → `specs/2026-08-20-report-usability-review.md` §6
 */
export function GraphList({ graph, unread, onOpenBoard }: {
  graph: CardGraph;
  /** Physical card names the synergy engine could not read (`unreadCardNames`). A row for one of
   *  these read "0 partners" -- the same thing a fully read card nothing connects to reads -- and
   *  those are different sentences: the first is a finding about the deck, the second is the
   *  engine's own gap. Absent, or empty, on a deck the engine read whole, and then nothing here
   *  is marked at all. */
  unread?: ReadonlySet<string>;
  /** Opens this card's own graph (roadmap R1). Absent on a surface with no board to open, and then
   *  no control renders -- a button that goes nowhere is worse than no button. */
  onOpenBoard?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const partners = new Map<string, Set<string>>();
    const strongest = new Map<string, { weight: number; text: string }>();
    for (const e of graph.edges) {
      for (const [self, other] of [[e.from, e.to], [e.to, e.from]] as const) {
        if (!partners.has(self)) partners.set(self, new Set());
        partners.get(self)!.add(other);
        const best = strongest.get(self);
        if (!best || e.weight > best.weight) {
          strongest.set(self, { weight: e.weight, text: e.reasonTexts[0] ?? "" });
        }
      }
    }
    return graph.nodes
      .map((n) => ({
        id: n.id,
        label: n.label,
        isToken: n.isToken === true,
        // The physical card, not the face: both faces of a multi-face card carry the same
        // `derived` flag, and `unreadCardNames` is keyed on `cardName ?? name` for exactly this
        // join -- the one `GraphView`'s commander set already makes.
        unread: unread?.has(n.cardName ?? n.id) === true,
        partners: partners.get(n.id)?.size ?? 0,
        reason: strongest.get(n.id)?.text ?? "",
      }))
      // Most connected first: on a list there is no geometry to carry "this is the middle of the
      // deck", so the ordering has to say it.
      .sort((a, b) => b.partners - a.partners || a.label.localeCompare(b.label));
  }, [graph, unread]);

  const unreadCount = rows.filter((r) => r.unread).length;
  const needle = query.trim().toLowerCase();
  const visible = needle === "" ? rows : rows.filter((r) => r.label.toLowerCase().includes(needle));

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        aria-label="Find a card"
        placeholder="Find a card…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="rounded-(--radius) border border-(--field-border) bg-transparent px-2.5 py-1 text-sm"
      />
      <p className="text-(--muted) text-sm">
        {graph.nodes.length} cards, {graph.edges.length} synergies
        {/* THE COUNT, BECAUSE A ROW-BY-ROW MARK CANNOT BE SURVEYED. The board says the same thing
          *  in a chip; this list has no chip row, and counting "not read" across 92 rows by
          *  scrolling is not counting. Silent on a deck the engine read whole. */}
        {unreadCount > 0 ? `, ${unreadCount} not read` : ""}. Tap a card for what it feeds and
        what feeds it{onOpenBoard ? ", or open its own graph" : ""}.
        {/* THE OLD CLAUSE SAID THE BOARD "NEEDS A WIDER SCREEN" AND IT IS FALSE NOW (roadmap R1).
          *  It was also the silent-substitution complaint in the first place: this list arrived
          *  instead of the board with no way to reach one, which is why the feature read as broken
          *  rather than adapted. */}
      </p>
      <ul className="flex flex-col">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-col gap-0.5 border-b border-(--separator) py-2">
            <span className="flex items-baseline justify-between gap-3">
              {/* A TOKEN IS NOT OPENABLE FROM HERE and says so by rendering as plain text: the
                *  drawer indexes card nodes, because 92 corpus token names collide with a real
                *  card's and a tap must never open the wrong one. */}
              <span className="min-w-0 truncate">
                {r.isToken ? <span>{r.label}</span> : <CardName name={r.label} />}
                {r.isToken ? <span className="ml-2 text-xs text-(--muted)">token</span> : null}
              </span>
              {r.unread ? (
                <span className="shrink-0 flex items-center gap-1.5 text-xs text-(--muted)">
                  {/* THE MARK ITSELF, at the size a swatch can carry it, so a reader meets the
                    *  hatch beside its own words here and recognises it on the board where there
                    *  is no room for a sentence. */}
                  <span
                    data-testid="unread-hatch"
                    aria-hidden="true"
                    className="h-3 w-3 rounded-[2px] border border-(--separator) bg-(--surface-tertiary)"
                    style={{ backgroundImage: hatchImage("var(--background)") }}
                  />
                  not read
                </span>
              ) : (
                <span className="shrink-0 stat-num text-xs text-(--muted)">
                  {r.partners} partner{r.partners === 1 ? "" : "s"}
                </span>
              )}
            </span>
            {r.reason ? <span className="text-xs text-(--muted) line-clamp-2">{r.reason}</span> : null}
            {/* THE SEARCH STEP'S OWN DOOR TO THE BOARD. A token is not openable for the same reason
              *  it is not a link above, and a card with no partners has no graph worth a screen --
              *  its ego view would be one disc, which the sheet says in words instead. */}
            {onOpenBoard && !r.isToken && r.partners > 0 ? (
              <button
                type="button"
                onClick={() => onOpenBoard(r.id)}
                className="self-start min-h-11 eyebrow text-(--accent)"
              >
                See what it connects to
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {visible.length === 0 ? <p className="text-(--muted) text-sm">No cards match.</p> : null}
    </div>
  );
}
