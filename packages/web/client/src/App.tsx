import { useEffect, useRef, useState } from "react";
import { analyzeDeck } from "./api.js";
import type { AnalyzeResponse } from "./types.js";
import { DeckInput } from "./components/DeckInput.js";
import { InstallButton } from "./components/InstallButton.js";
import { ReportView } from "./components/ReportView.js";
import { EXAMPLE_DECK } from "./lib/example-deck.js";
import { diffRuns, loadLastRun, saveLastRun, snapshotRun, type RunDiff } from "./lib/run-diff.js";
import { decodeShare, encodeShare, payloadFromHash, shareUrl } from "./lib/share-link.js";

export default function App() {
  const [commanders, setCommanders] = useState("");
  const [decklist, setDecklist] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(true);
  // What the last Re-analyze moved. Held in state rather than derived on render because it is a
  // fact about a TRANSITION -- once the snapshot is written, the same `data` no longer implies it.
  const [diff, setDiff] = useState<RunDiff | null>(null);

  /** THE ANALYSIS THIS PAGE IS SHOWING, AS A LINK. Written after a successful run and kept in state
   *  so the copy button hands out what is on screen rather than what is in the boxes -- those differ
   *  the moment someone edits the decklist without re-analysing. */
  const [link, setLink] = useState<string | null>(null);

  async function analyse(deckText: string, commanderText: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await analyzeDeck(deckText, commanderText);
      const previous = loadLastRun();
      const snapshot = snapshotRun(next);
      setDiff(previous ? diffRuns(previous, snapshot) : null);
      saveLastRun(snapshot);
      setData(next);
      setEditing(false);
      // THE ADDRESS BAR BECOMES THE SHARE LINK, which is what makes this get used: a reader who
      // analyses a deck can copy the URL without knowing the feature exists. `replaceState` rather
      // than a navigation, so re-analysing does not fill the back button with near-identical
      // entries. A deck too long to encode leaves the URL alone rather than writing a broken one.
      const payload = await encodeShare({ commanders: commanderText, decklist: deckText });
      setLink(payload ? shareUrl(window.location.origin, window.location.pathname, payload) : null);
      if (payload) {
        window.history.replaceState(null, "", `#deck=${payload}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const onAnalyze = () => void analyse(decklist, commanders);

  /** A SHARED LINK IS A DECK THAT ANALYSES ITSELF. Anything else -- filling the boxes and waiting for
   *  a click -- makes the recipient do the work the sender already did.
   *
   *  Runs once. The ref is not defensiveness about StrictMode's double invocation alone: `analyse`
   *  writes the hash it just read, so without it this effect is its own trigger. */
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current) return;
    openedFromLink.current = true;
    const payload = payloadFromHash(window.location.hash);
    if (!payload) return;
    void decodeShare(payload).then((deck) => {
      if (!deck) return; // a link that does not decode leaves an empty paste box, as if it were absent
      setCommanders(deck.commanders);
      setDecklist(deck.decklist);
      void analyse(deck.decklist, deck.commanders);
    });
  }, []);

  return (
    // THE COLUMN USED TO STOP AT 1024px. On a 1920 screen that left 448px of empty gutter on each
    // side -- 47% of the viewport -- while the report ran 3,092px tall, i.e. 2.9 screens of
    // scrolling past dead space. The reference tools this product is measured against (Moxfield,
    // Archidekt, Scryfall) all use the width.
    //
    // Above `xl` the cap comes off entirely -- a centred 1600px column on a 1920 screen still left
    // 160px of dead margin each side, which is the same complaint one step smaller. The width is
    // safe to give away because nothing here stretches with it: the report flows into columns
    // (`OverviewTab`) and every run of prose carries its own measure cap, so growing the container
    // adds columns rather than 200-character lines. Below `xl` the reading column is unchanged.
    // `min-h-screen` and the background moved to `body` (index.css) when the static intro in
    // `index.html` put real content outside this element: a short analysis left `main` filling the
    // viewport, so the explainer started a full screen below the fold with a band of unpainted page
    // between them.
    <main className="p-8 w-full max-w-5xl xl:max-w-none mx-auto flex flex-col gap-8">
      {/* RENDERS NOTHING HERE. It portals into the static header's nav, and only once the browser
        *  has said the app can be installed -- see `InstallButton` for why the event is the whole
        *  gate. Mounted from the app rather than from `index.html` because the decision is stateful
        *  and the header is not. */}
      <InstallButton />
      {
        /*
        THESIS: The category standard, taken on purpose — a plain dark analytics
        dashboard, not an illustrated MTG-card pastiche or a cross-domain metaphor.
        OWN-WORLD: a near-black VIOLET ground, off-white text with the same cast, one
        FIXED magenta accent that no deck can change (DESIGN.md v2); Inter throughout,
        JetBrains Mono for every number/label; flat, border-driven surfaces; ranked
        data reads as tables.
        STORY: paste a decklist, get a dense report that reads like the reference
        tools this player already trusts daily.
        FIRST VIEWPORT: wordmark, input panel, then (post-analysis) tabbed report —
        stat tiles, a ranked card table, archetypes, combos.
        FORM: canon, chosen over two rolled alternates (seed-catalog, tournament-
        standings) at the user's decision; craft bar = Scryfall, Archidekt/Moxfield.
        Seed chain: 508515db -> 913b3f8c -> canon.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the
        finish review, the verdict, and DESIGN.md.
        */
      }
      {/* The header is static HTML in `index.html` now, above `#root`: it is the site's name and
          its nav, neither of which should wait for a bundle, and it carries the page's `h1` where a
          crawler can read it. The identity picker that used to sit at its right, and the gradient
          rule under it, went with DESIGN.md v2. */}
      <DeckInput
        commanders={commanders}
        onCommandersChange={setCommanders}
        value={decklist}
        onChange={setDecklist}
        onAnalyze={onAnalyze}
        loading={loading}
        collapsed={!editing && !!data}
        onEdit={() => setEditing(true)}
        shareLink={link}
      />
      {!data && !loading && decklist.trim() === "" && (
        <div className="flex flex-col gap-2 text-sm text-(--muted)">
          <p>Paste a decklist to get an oracle-text synergy read — mana curve, land math, build benchmarks, per-card roles, and combos. No account needed.</p>
          <button
            type="button"
            className="self-start eyebrow px-3 py-1 rounded-(--radius) border border-(--separator) text-(--accent)"
            onClick={() => { setCommanders(EXAMPLE_DECK.commanders); setDecklist(EXAMPLE_DECK.decklist); }}
          >
            Load example deck
          </button>
        </div>
      )}
      {error && (
        <div className="text-danger border border-danger rounded-(--radius) p-3 text-sm font-mono">{error}</div>
      )}
      {data && (
        <div className="reveal">
          <ReportView data={data} diff={diff} />
        </div>
      )}
      {/* The fan-content notice used to render here. It is static HTML in `index.html` now, after
          the intro section: a footer inside `main` stopped being at the foot the moment any content
          lived outside it, and a notice that is a CONDITION of showing Wizards' property should not
          depend on the bundle loading at all. */}
    </main>
  );
}
