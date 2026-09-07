import { useEffect, useState } from "react";
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
  node, edges, flow, textOf, nameOf, onClose, pinned, onTogglePin, phone = "sheet",
}: {
  node: GraphNode;
  /** HOW THE PANEL SITS BELOW `sm`. "sheet" fills its container, which is right for the Cards
   *  drawer (nothing behind it the reader needs). "half" hugs the bottom at no more than half the
   *  container, for the board: owner, 2026-09-06, "you click a node and the dock opens which
   *  covers whole screen so you see nothing on the graph basically" -- the panel describes a
   *  picture it must not hide, the same reason the ego view reads its edge in a strip. At `sm`
   *  and up both are the right-hand panel they always were. */
  phone?: "sheet" | "half";
  /** Whether the card this panel is showing is in the reader's pinned set (roadmap S8).
   *
   *  PASSED, NOT READ FROM THE CONTEXT, and that is an import cycle rather than a preference:
   *  `card-drawer.tsx` imports THIS module to render the drawer, so importing `usePinned` back
   *  would close the loop. The panel stays presentational, as it already was. Both props absent on
   *  the graph board's own inspector, where there is nothing to pin into. */
  pinned?: boolean;
  onTogglePin?: () => void;
  edges: readonly Edge[];
  /** The PARTNER's printed text, by node id. Every sentence in this panel is a claim about a card
   *  whose text the panel did not show, and a skeptic review put the consequence plainly: "a right
   *  answer and a wrong answer are the same pixels". It could audit only the two pairs it believed
   *  it knew -- Samwise Gamgee and Aragorn, the Uniter -- and misremembered both, calling the engine
   *  wrong where oracle text says it is right. An expert getting it wrong from memory is the whole
   *  argument for putting the evidence next to the claim.
   *
   *  Optional so every existing caller and fixture keeps working; a row with no text simply shows
   *  no disclosure rather than an empty one. */
  textOf?: (id: string) => string | undefined;
  /** A partner node's DISPLAY NAME by id, and whether that node is a token.
   *
   *  The rows print edge endpoints, and an endpoint is a node ID -- which for a token is
   *  `token:<name>`, so a row read "Shark Typhoon → token:Shark". The phone judge called it what it
   *  is: *"reads like an internal name rather than something I'd say out loud."*
   *
   *  NOT SOLVED BY STRIPPING THE PREFIX. That prefix is load-bearing: 92 of the corpus's 661 token
   *  names are also a real card, which is the whole reason token nodes have their own id space, and
   *  a bare "Shark" would present a token as a card. So the resolver returns the label AND the
   *  token flag, and the row keeps saying which it is -- the same rule `GraphList` follows two files
   *  over, where a token renders as plain text with a "token" marker rather than as an openable card.
   *
   *  Optional, so every existing caller and fixture keeps working; unresolved ids fall back to the
   *  id itself rather than to an invented name. */
  nameOf?: (id: string) => { label: string; isToken: boolean } | undefined;
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
  /** WHICH FACE THE PANEL IS SHOWING. A double-faced card drew only its front here -- the image,
   *  the name and (until the printed type line landed) the type were all the front's, and the back
   *  was unreachable. Owner, 2026-08-27: "for double faced cards we need a way to present them,
   *  cause right now you see only front."
   *
   *  Index 0 (the front) is the fallback, because that is the side the card is played from and the
   *  side the board draws by default. Seeded from the CLICKED node's own `face` instead, so a back
   *  face's own node (Task 8: `n.face` is its index into this same `faces` array, stamped by the
   *  server off the doc both nodes join) opens the panel already flipped -- the click already told
   *  the panel which side the user meant. Re-seeded whenever the selected card changes (its `id`
   *  differs per face, since a face is its own node), or flipping one card would leave the next one
   *  opening on the wrong side. */
  const [faceIdx, setFaceIdx] = useState(node.face ?? 0);
  useEffect(() => { setFaceIdx(node.face ?? 0); }, [node.id, node.face]);
  const faces = node.faces ?? [];
  const face = faces.length > 1 ? faces[Math.min(faceIdx, faces.length - 1)] : undefined;
  // ONE ANSWER FOR "IS THE CARD ITSELF ON SCREEN", read by the image and by the text below it: the
  // panel prints the oracle text only when the picture is not already printing it.
  const hasImage = Boolean(face?.artCrop ?? node.artCrop);

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
          // The id is the FALLBACK, never an invented name: an unresolved node prints exactly what
          // the graph called it, which is checkable, rather than a guess that reads like a card.
          const named = nameOf?.(partner);
          const partnerName = named?.label ?? partner;
          const partnerCell = (
            <>
              {partnerName}
              {named?.isToken === true ? (
                <span
                  data-testid="partner-token"
                  className="ml-1.5 eyebrow text-(--muted)"
                >
                  token
                </span>
              ) : null}
            </>
          );
          return (
            <li key={`${e.from}->${e.to}`} className="flex flex-col gap-0.5">
              <div className="flex justify-between gap-2">
                <span>
                  {isOutgoing
                    ? <>{node.label} → {partnerCell}</>
                    : <>{partnerCell} → {node.label}</>}
                </span>
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
              {/* THE EVIDENCE, ONE CLICK FROM THE CLAIM, AND COLLAPSED BY DEFAULT. Sixty-two rows of
                *  oracle text would bury the relationships this panel exists to list -- and the
                *  reader who wants to CHECK one claim wants one card's text, not every card's. The
                *  partner is the card the sentence is about and the card the panel never showed;
                *  this card's own text is already in the image above. */}
              {textOf?.(partner) ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-(--muted) hover:text-(--accent)">
                    {partner}'s text
                  </summary>
                  <p className="mt-1 whitespace-pre-line text-(--muted)">{textOf(partner)}</p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div
      data-testid="card-inspector"
      className={`absolute right-2 left-2 ${
        phone === "half" ? "bottom-2 top-auto max-h-[50%] sm:top-2 sm:max-h-none" : "inset-y-2"
      } sm:left-auto sm:w-72 sm:max-w-[85vw] overflow-y-auto rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm flex flex-col gap-3`}
    >
      <button type="button" onClick={onClose} className="eyebrow self-end text-(--muted)">
        close
      </button>

      {/* BOUNDED, BECAUSE THE IMAGE WAS EATING THE WHOLE PANEL AND THE RELATIONSHIPS ARE THE PRODUCT.
        *  MEASURED on the review deck: the panel is 500px tall with 1,415px of content, and FEEDS
        *  began 49px BELOW its own bottom edge -- so two thirds of it was reachable only by
        *  scrolling a box with no affordance, and nothing above the fold hinted there was more.
        *  Across two persona rounds, three reviewers clicked a card and reported the panel tells
        *  them nothing: "I clicked a card hoping to be told something and was shown the card",
        *  and "the tool makes ~300 counted claims and shows me the operands of none of them".
        *  I twice wrote this off as a screenshot crop; it is the panel's own layout.
        *
        *  The image STAYS and stays first -- a reader who clicked an art disc needs to know which
        *  card they hit, and the name alone does not do that at a glance.
        *
        *  IT IS SIZED BY ITS WIDTH NOW, NOT CAPPED BY ITS HEIGHT (owner, 2026-09-03: *"the card
        *  should be bigger, it is very small in comparison to the width of the drawer"*). `max-h-52`
        *  put a 208px ceiling on a 262px-wide box, and a Magic card is 488x680 -- so `object-contain`
        *  letterboxed it to 208 tall by **149 wide inside a 262 box**, painting the card at 52% of
        *  the panel's width with 113px of empty box beside it. Measured in the browser, not inferred.
        *  `aspect-[488/680]` makes the BOX the card's own shape, so `w-full` fills the panel edge to
        *  edge and nothing letterboxes; the box is also reserved before the image loads, which the
        *  height cap never did.
        *
        *  THE HEIGHT CAP'S REASON SURVIVES AS `max-w-[32vh]`. It existed so the first relationship
        *  clears the fold -- three reviewers across two persona rounds clicked a card and reported
        *  the panel told them nothing, because the image filled it. A height ceiling is the wrong
        *  instrument for that (it letterboxes at every width); bounding the WIDTH bounds the height
        *  through the aspect, at 0.718 x 32vh = about 45vh, and keeps the box aspect-correct while
        *  doing it. On a short viewport the card shrinks and stays centred; on a tall one it fills
        *  the panel. `object-contain` stays as the guarantee that a card face is never stretched. */}
      {hasImage ? (
        <img
          src={cardImageUrl((face?.artCrop ?? node.artCrop)!)}
          alt={face?.name ?? node.label}
          // NOT IN THE HALF SHEET BELOW `sm`. The sheet is ~35vh; measured at 390, a 14vh card still
          // left the first pair 130px under the sheet's fold behind the close row, the name, the
          // type line, the text disclosure and the pin. The board is already drawing this card's
          // art on its disc, and the pairs are what the tap asked for.
          className={`w-full ${phone === "half" ? "hidden sm:block" : ""} max-w-[32vh] mx-auto aspect-[488/680] object-contain shrink-0 rounded-(--radius) border border-(--separator)`}
        />
      ) : null}

      {/* THE FLIP, ONLY WHEN THERE IS SOMETHING TO FLIP TO. A control that cannot change anything is
        *  worse than none, so a single-face card renders nothing here. The button names the side you
        *  would GO to, not the one you are on -- "Megatron, Destructive Force" is a destination and
        *  "front" is a state, and a reader who has to work out which is which has been given a
        *  puzzle rather than a control. */}
      {faces.length > 1 ? (
        <div className="flex flex-wrap gap-1" data-testid="face-flip">
          {faces.map((f, i) => (
            <button
              key={f.name || i}
              type="button"
              aria-pressed={i === faceIdx}
              onClick={() => setFaceIdx(i)}
              className={`eyebrow rounded-(--radius) border px-2 py-0.5 ${
                i === faceIdx ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
              }`}
            >
              {f.name || `face ${i + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="text-base font-medium">
          {face ? face.name : node.label}
          {node.copies > 1 ? (
            <span className="ml-1.5 stat-num text-(--muted)">×{node.copies}</span>
          ) : null}
        </h3>
        {/* THE CHOSEN FACE'S OWN TYPE LINE. The whole printed line ("… — Robot // … — Vehicle")
          *  is right when the panel is describing the CARD; once it is describing one FACE, that
          *  face's own line is the true sentence and the joined one names an object you are not
          *  looking at. */}
        <p className="text-(--muted) text-xs">{face?.typeLine ?? typeLine}</p>
        {face?.manaCost ? (
          <p className="text-(--muted) text-xs">{face.manaCost}</p>
        ) : null}
        {/* THE CARD'S OWN TEXT, AND IT WAS ONLY EVER DRAWN FOR MULTI-FACE CARDS (roadmap S18).
          *  `face` is set only when `faces.length > 1`, so a single-face card fell through this
          *  condition and printed no text at all -- while `node.oracleText` sat on the wire beside
          *  it, carrying the comment "so the panel can show the evidence for a claim about it".
          *  The type line one row up had the fallback (`face?.typeLine ?? typeLine`); this did not.
          *
          *  IT IS THE WHOLE OF S18'S ASK. The skeptic could not check a single synergy claim on
          *  nine screens -- "the page asserts a relationship between two named cards and never
          *  prints either card's text, so a right answer and a wrong one look identical on my
          *  screen" -- and the roadmap line recorded this panel as already showing the partner's
          *  text one click away. It did not, for any card with one face. */}
        {/* THE CARD IMAGE ALREADY PRINTS THIS TEXT, so showing it twice fills the panel with a
          *  second copy of what the reader is looking at (owner-reported 2026-09-04). It does NOT
          *  simply go: the skeptic's finding above is still true wherever the image is absent -- a
          *  token, a card whose art never resolved, a reader on a slow link -- and image text is
          *  invisible to a screen reader and cannot be selected or searched.
          *  So it stays, folded, whenever the picture is carrying it, and stands open when nothing
          *  else is. `<details>` is the whole mechanism: assistive technology reads it either way. */}
        {(face?.oracleText ?? node.oracleText) ? (
          hasImage ? (
            <details className="mt-1">
              <summary className="eyebrow text-(--muted) cursor-pointer">card text</summary>
              <p className="mt-1 whitespace-pre-line text-(--muted) text-xs">
                {face?.oracleText ?? node.oracleText}
              </p>
            </details>
          ) : (
            <p className="mt-1 whitespace-pre-line text-(--muted) text-xs">
              {face?.oracleText ?? node.oracleText}
            </p>
          )
        ) : null}
        {/* THE PIN LIVES HERE, NOT ON THE NAME (roadmap S8). Click already opens this drawer and
          *  S18 made that gesture load-bearing -- it is how a reader checks a claim against the
          *  card's own text -- so pinning is a control inside the thing the click opened rather
          *  than a second gesture competing with it. `aria-pressed` carries the state, because a
          *  screen reader gets no ring. */}
        {onTogglePin ? (
          <button
            type="button"
            aria-pressed={pinned === true}
            onClick={onTogglePin}
            className="eyebrow mt-2 self-start px-2 py-1 rounded-(--radius) border border-(--separator) text-(--muted) hover:text-(--accent) hover:border-(--accent) min-h-[24px]"
          >
            {pinned ? "Unpin across the report" : "Pin across the report"}
          </button>
        ) : null}
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
            {/* THE TOTAL LIVES IN THE HEADING, ONCE (roadmap R1, phone judge 2026-09-03). This
              *  panel used to print "all 42 are listed here" under a surface line reading "7 of 43
              *  partners", and both were right -- 43 is distinct partners across BOTH directions,
              *  42 is the fed-by count alone -- which is precisely why the collision was invisible
              *  to us and immediate to a reader. Three numbers for one card in two taps.
              *
              *  CEILING: `feeds + fed by` does NOT always equal the distinct-partner total. Measured
              *  on the example deck, 4 of 88 cards have a partner in both directions, so a reader
              *  who adds the two headings gets one more than the surface line. Each heading is
              *  truthful about its own section; the sum is not advertised as a total anywhere. */}
            <h4 className="eyebrow text-(--muted)">Feeds {outgoing.length}</h4>
            {/* THE SENTENCE IS ABOUT THE BOARD, AND IT HAS TO SAY SO. The flow caps at
             *  FLOW_FANOUT_CAP edges per card, so a hub with 67 consumers DRAWS 6 -- but this panel
             *  renders every one of them (`sorted` is unsliced, below). Sitting as a header over
             *  that complete list, "67 in total · strongest 6 shown" read as describing the LIST,
             *  and a reviewer reading this very panel concluded the other 61 relations were
             *  unreachable. If the author of a truncation note can misread it, so can a player. */}
            {cutDown ? (
              <p className="text-(--muted) text-xs">
                The board draws the strongest {cutDown.shown} of them; every one is below.
              </p>
            ) : null}
            {renderList(outgoing, true)}
          </>
        )}
      </div>

      {sorted.length > 0 ? (
        <div className="border-t border-(--separator) pt-2 flex flex-col gap-2">
          <h4 className="eyebrow text-(--muted)">Fed by {incoming.length}</h4>
          {cutUp ? (
            <p className="text-(--muted) text-xs">
              The board draws the strongest {cutUp.shown} of them; every one is below.
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
