import { useState } from "react";
import { analyzeDeck } from "./api.js";
import type { AnalyzeResponse } from "./types.js";
import { DeckInput } from "./components/DeckInput.js";
import { ReportView } from "./components/ReportView.js";
import { Logotype } from "./components/Logotype.js";
import { EXAMPLE_DECK } from "./lib/example-deck.js";
import { diffRuns, loadLastRun, saveLastRun, snapshotRun, type RunDiff } from "./lib/run-diff.js";

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

  async function onAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const next = await analyzeDeck(decklist, commanders);
      const previous = loadLastRun();
      const snapshot = snapshotRun(next);
      setDiff(previous ? diffRuns(previous, snapshot) : null);
      saveLastRun(snapshot);
      setData(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

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
      {/* The picker that used to sit at the right of this row, and the identity gradient that ran
          under it, are gone with v2: they let the deck repaint the chrome, which reads as a
          decoration the user cannot switch off and says nothing a mana pip does not say better.
          The rule under the header is now a plain --border hairline, the same one every panel
          uses, so the header stops being the one element with its own colour system. */}
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              <Logotype />
            </h1>
            <span className="text-sm text-(--muted)">Oracle-level deck reading</span>
          </div>
        </div>
        <div className="h-px bg-(--border)" />
      </header>
      <DeckInput
        commanders={commanders}
        onCommandersChange={setCommanders}
        value={decklist}
        onChange={setDecklist}
        onAnalyze={onAnalyze}
        loading={loading}
        collapsed={!editing && !!data}
        onEdit={() => setEditing(true)}
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
