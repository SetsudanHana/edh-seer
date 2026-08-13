import type { CardGraph, GraphNode } from "../types.js";
import { cardImageUrl } from "./card-node.js";
import { subcategoryLabel } from "./presets.js";

type Edge = CardGraph["edges"][number];

/** Everything a click on a card can show: what it IS (art, type line, roles) and every synergy
 *  edge naming it -- on EITHER end, strongest first. This is the drill-down that makes collapsing
 *  the event layer honest: without it, a visual claim (an edge drawn on the board) has nothing to
 *  click through to.
 *
 *  Provenance bottoms out at TAG + TEXT. `Reason` (server-side) carries no clause id, so this
 *  cannot say which normalized clause produced an edge -- only the tag that classified it and the
 *  oracle-text-derived sentence that explains it. That is a real limit, recorded on the ROADMAP,
 *  not papered over with an invented id here. */
export function CardInspector({
  node, edges, onClose,
}: {
  node: GraphNode;
  edges: readonly Edge[];
  onClose: () => void;
}) {
  const typeLine = [...node.supertypes, ...node.types].join(" ")
    + (node.subtypes.length > 0 ? ` — ${node.subtypes.join(" ")}` : "");
  // Strongest first -- the same ordering `edgeWidth`/`linkDistanceFor` already give the board
  // itself, so the panel agrees with what the geometry is claiming.
  const sorted = [...edges].sort((a, b) => b.weight - a.weight);

  return (
    <div
      data-testid="card-inspector"
      className="absolute inset-y-2 right-2 w-72 max-w-[85vw] overflow-y-auto rounded-(--radius) border border-(--border) bg-(--surface) p-3 text-sm flex flex-col gap-3"
    >
      <button type="button" onClick={onClose} className="eyebrow self-end text-(--muted)">
        close
      </button>

      {node.artCrop ? (
        <img
          src={cardImageUrl(node.artCrop)}
          alt={node.label}
          className="w-full rounded-(--radius) border border-(--border)"
        />
      ) : null}

      <div>
        <h3 className="text-base font-medium">
          {node.label}
          {node.copies > 1 ? (
            <span className="ml-1.5 font-mono tabular-nums text-(--muted)">×{node.copies}</span>
          ) : null}
        </h3>
        <p className="text-(--muted) text-xs">{typeLine}</p>
      </div>

      {node.roles && node.roles.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {node.roles.map((r) => (
            <span
              key={r}
              className="eyebrow px-1.5 py-0.5 rounded-(--radius) border border-(--separator) text-(--muted)"
            >
              {subcategoryLabel(r)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="border-t border-(--separator) pt-2 flex flex-col gap-2">
        <h4 className="eyebrow text-(--muted)">Synergy edges</h4>
        {/* An empty edge list is the orphan diagnostic and has to read as a finding, not a blank
         *  panel that leaves a reader wondering whether the click even worked. */}
        {sorted.length === 0 ? (
          <p className="text-(--muted)">No synergy edges — nothing else in the deck connects to this card.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((e) => {
              // An edge is directed; this card can be the producer on one edge and the consumer on
              // the next. The arrow always points from what's named first toward what's named
              // second, so which side `node` sits on tells a reader which direction this edge runs.
              const outgoing = e.from === node.id;
              const partner = outgoing ? e.to : e.from;
              return (
                <li key={`${e.from}->${e.to}`} className="flex flex-col gap-0.5">
                  <div className="flex justify-between gap-2">
                    <span>{outgoing ? `${node.label} → ${partner}` : `${partner} → ${node.label}`}</span>
                    <span className="font-mono tabular-nums text-(--muted) shrink-0">
                      {e.weight.toFixed(1)}
                    </span>
                  </div>
                  {e.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {e.tags.map((t) => (
                        <span
                          key={t}
                          className="eyebrow px-1 py-0.5 rounded-(--radius) border border-(--separator) text-(--muted)"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {e.reasonTexts.map((text, i) => (
                    <p key={i} className="text-(--muted) text-xs">{text}</p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
