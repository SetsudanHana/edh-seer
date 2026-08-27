import type { CardGraph, GraphNode } from "../types.js";
import { tagLabel } from "../lib/demand-sentence.js";
import { cardImageUrl } from "./card-node.js";
import { routesThrough } from "../lib/routes.js";
import { demandSentence } from "../lib/demand-sentence.js";
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
  node, edges, flow, onClose,
}: {
  node: GraphNode;
  edges: readonly Edge[];
  /** The drawn flow, when a flow is active. Only `truncated` is read: the panel states what the
   *  board had to leave out -- direction-keyed, since the root can have its own fanout cut on
   *  BOTH walks and each has to report its own count under its own heading. */
  flow?: { truncated: Map<string, { up?: { total: number; shown: number }; down?: { total: number; shown: number } }> } | null;
  onClose: () => void;
}) {
  /** THE PRINTED LINE, NOT A LINE RECOMPOSED FROM THE UNION.
   *
   *  `node.types`/`subtypes`/`supertypes` are the union over EVERY face -- correct for the paint
   *  legend, where a node really does show a hue per type it can be. Joining them back into a type
   *  line invents an object no face is: a skeptic review, 2026-08-27, read
   *  "legendary artifact creature — robot vehicle" under a card image printing "Legendary Artifact
   *  Creature — Robot" and said "merging them describes an object that neither face is". Megatron's
   *  node genuinely carries `subtypes: ["robot", "vehicle"]`, one from each face.
   *
   *  The printed line keeps its faces ("… — Human Citizen // Legendary Artifact"), which agrees with
   *  the name line directly above it -- that already prints both halves -- and with the card image.
   *  The union is kept as the fallback rather than deleted: an older cached graph carries no
   *  `typeLine`, and a recomposed line is still better than none. */
  const typeLine = node.typeLine
    ?? [...node.supertypes, ...node.types].join(" ")
      + (node.subtypes.length > 0 ? ` — ${node.subtypes.join(" ")}` : "");
  // Strongest first -- the same ordering `edgeWidth`/`linkDistanceFor` already give the board
  // itself, so the panel agrees with what the geometry is claiming.
  const sorted = [...edges].sort((a, b) => b.weight - a.weight);
  // An edge is directed and this card can sit on either end -- split into what it FEEDS (producer)
  // and what FEEDS it (consumer) rather than one undifferentiated list, so the panel reads the same
  // direction the board's arrows do.
  const outgoing = sorted.filter((e) => e.from === node.id);
  const incoming = sorted.filter((e) => e.to === node.id);
  // TWO-HOP ROUTES, and the card in the middle that makes each one exist. The lists above are one
  // hop each, so a relationship that runs THROUGH a third card was invisible: the owner's case is
  // that Ghyrson Starn does not synergise with token creation until Impact Tremors is added, at
  // which point tokens entering become damage and the route exists. Both edges were always formed
  // and neither list could say so.
  const routes = routesThrough(edges, node.id);
  const cutDown = flow?.truncated.get(node.id)?.down;
  const cutUp = flow?.truncated.get(node.id)?.up;

  // Shared <li> markup for one direction's list -- the row text and direction are fixed by which
  // group a caller passes (every edge in `outgoing` has `node` as `from`, every edge in `incoming`
  // has `node` as `to`), so there is no per-edge direction check left to make here. A one-directional
  // card renders "None" rather than a heading with nothing beneath it.
  const renderList = (list: readonly Edge[], isOutgoing: boolean) =>
    list.length === 0 ? <p className="text-(--muted) text-xs">None</p> : (
      <ul className="flex flex-col gap-2">
        {list.map((e) => {
          const partner = isOutgoing ? e.to : e.from;
          return (
            <li key={`${e.from}->${e.to}`} className="flex flex-col gap-0.5">
              <div className="flex justify-between gap-2">
                <span>{isOutgoing ? `${node.label} → ${partner}` : `${partner} → ${node.label}`}</span>
                <span className="stat-num text-(--muted) shrink-0">
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
                      {tagLabel(t)}
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
    );

  return (
    <div
      data-testid="card-inspector"
      className="absolute inset-y-2 right-2 w-72 max-w-[85vw] overflow-y-auto rounded-(--radius) border border-(--border) bg-(--surface) p-3 text-sm flex flex-col gap-3"
    >
      <button type="button" onClick={onClose} className="eyebrow self-end text-(--muted)">
        close
      </button>

      {/* CAPPED, BECAUSE THE IMAGE WAS EATING THE WHOLE PANEL AND THE RELATIONSHIPS ARE THE PRODUCT.
        *  MEASURED on the review deck: the panel is 500px tall with 1,415px of content, and FEEDS
        *  began 49px BELOW its own bottom edge -- so two thirds of it was reachable only by
        *  scrolling a box with no affordance, and nothing above the fold hinted there was more.
        *  Across two persona rounds, three reviewers clicked a card and reported the panel tells
        *  them nothing: "I clicked a card hoping to be told something and was shown the card",
        *  and "the tool makes ~300 counted claims and shows me the operands of none of them".
        *  I twice wrote this off as a screenshot crop; it is the panel's own layout.
        *
        *  The image STAYS and stays first -- a reader who clicked an art disc needs to know which
        *  card they hit, and the name alone does not do that at a glance. It is capped so the first
        *  relationship clears the fold, which is what tells them the panel continues.
        *  `object-contain` keeps the card's aspect ratio: a portrait card in a wide box letterboxes
        *  rather than stretching, and a stretched card face is worse than a small one. */}
      {node.artCrop ? (
        <img
          src={cardImageUrl(node.artCrop)}
          alt={node.label}
          className="w-full max-h-52 object-contain shrink-0 rounded-(--radius) border border-(--border)"
        />
      ) : null}

      <div>
        <h3 className="text-base font-medium">
          {node.label}
          {node.copies > 1 ? (
            <span className="ml-1.5 stat-num text-(--muted)">×{node.copies}</span>
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
        {/* An empty edge list is the orphan diagnostic and has to read as a finding, not a blank
         *  panel that leaves a reader wondering whether the click even worked. */}
        {sorted.length === 0 ? (
          <>
            <h4 className="eyebrow text-(--muted)">Synergy edges</h4>
            <p className="text-(--muted)">No synergy edges — nothing else in the deck connects to this card.</p>
          </>
        ) : (
          <>
            <h4 className="eyebrow text-(--muted)">Feeds</h4>
            {/* THE SENTENCE IS ABOUT THE BOARD, AND IT HAS TO SAY SO. The flow caps at
             *  FLOW_FANOUT_CAP edges per card, so a hub with 67 consumers DRAWS 6 -- but this panel
             *  renders every one of them (`sorted` is unsliced, below). Sitting as a header over
             *  that complete list, "67 in total · strongest 6 shown" read as describing the LIST,
             *  and a reviewer reading this very panel concluded the other 61 relations were
             *  unreachable. If the author of a truncation note can misread it, so can a player. */}
            {cutDown ? (
              <p className="text-(--muted) text-xs">
                The board draws the strongest {cutDown.shown} — all {cutDown.total} are listed here
              </p>
            ) : null}
            {renderList(outgoing, true)}
          </>
        )}
      </div>

      {sorted.length > 0 ? (
        <div className="border-t border-(--separator) pt-2 flex flex-col gap-2">
          <h4 className="eyebrow text-(--muted)">Fed by</h4>
          {cutUp ? (
            <p className="text-(--muted) text-xs">
              The board draws the strongest {cutUp.shown} — all {cutUp.total} are listed here
            </p>
          ) : null}
          {renderList(incoming, false)}
        </div>
      ) : null}

      {/* THE ROUTE, NAMED AT EVERY STEP. A player can see three cards connected on the board and
        *  still not know why; what makes this readable is that both mechanisms are spelled out, and
        *  that the middle card is the subject of the sentence rather than a waypoint in it — it is
        *  the card whose presence bought the route, which is the thing a deckbuilder acts on. */}
      {routes.length > 0 ? (
        <div className="border-t border-(--separator) pt-2 flex flex-col gap-2">
          <h4 className="eyebrow text-(--muted)">Reached through</h4>
          <ul className="flex flex-col gap-2">
            {routes.map((r) => (
              <li key={`${r.dir}:${r.through}`} className="flex flex-col gap-0.5">
                <div className="text-xs">
                  <span className="stat-num">{r.total}</span>{" "}
                  {r.total === 1 ? "card" : "cards"}{" "}
                  {r.dir === "in" ? "reach" : "are reached by"} {node.label} through{" "}
                  <span className="text-(--accent)">{r.through}</span>
                </div>
                {/* The chain in the order it happens, so it reads as one sentence rather than as
                  *  two tags a reader has to compose themselves. */}
                {r.farTag && r.nearTag ? (
                  <div className="text-xs text-(--muted)">
                    {demandSentence(r.dir === "in" ? r.farTag : r.nearTag)} → {r.through} →{" "}
                    {demandSentence(r.dir === "in" ? r.nearTag : r.farTag)}
                  </div>
                ) : null}
                <div className="text-xs text-(--muted)">
                  {r.ends.join(", ")}{r.total > r.ends.length ? ` and ${r.total - r.ends.length} more` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
