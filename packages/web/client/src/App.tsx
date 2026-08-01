import { useState } from "react";
import { analyzeDeck } from "./api.js";
import type { AnalyzeResponse } from "./types.js";
import { DeckInput } from "./components/DeckInput.js";
import { ReportView } from "./components/ReportView.js";
import { ColorIdentityPicker } from "./components/ColorIdentityPicker.js";
import { useAccentIdentity } from "./lib/use-accent-identity.js";
import { identityGradient } from "./lib/color-identity.js";
import { EXAMPLE_DECK } from "./lib/example-deck.js";

export default function App() {
  const [commanders, setCommanders] = useState("");
  const [decklist, setDecklist] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { manualPick, setManualPick, active } = useAccentIdentity(data?.commanderColorIdentity);

  async function onAnalyze() {
    setLoading(true);
    setError(null);
    try {
      setData(await analyzeDeck(decklist, commanders));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-8 max-w-5xl mx-auto flex flex-col gap-8">
      {
        /*
        THESIS: The category standard, taken on purpose — a plain dark analytics
        dashboard, not an illustrated MTG-card pastiche or a cross-domain metaphor.
        OWN-WORLD: near-black graphite, off-white text, one identity-driven accent
        (client/src/lib/color-identity.ts); Inter throughout, JetBrains Mono for
        every number/label; flat, border-driven surfaces; ranked data reads as tables.
        STORY: paste a decklist, get a dense report that reads like the reference
        tools this player already trusts daily.
        FIRST VIEWPORT: wordmark + color-identity picker, input panel, then (post-
        analysis) tabbed report — stat tiles, a ranked card table, archetypes, combos.
        FORM: canon, chosen over two rolled alternates (seed-catalog, tournament-
        standings) at the user's decision; craft bar = Scryfall, Archidekt/Moxfield.
        Seed chain: 508515db -> 913b3f8c -> canon.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the
        finish review, the verdict, and DESIGN.md.
        */
      }
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold tracking-tight">MTG Synergy</h1>
            <span className="text-sm text-(--muted)">Oracle-level deck reading</span>
          </div>
          <ColorIdentityPicker value={manualPick} onChange={setManualPick} />
        </div>
        <div className="h-[3px] rounded-full" style={{ background: identityGradient(active) }} />
      </header>
      <DeckInput
        commanders={commanders}
        onCommandersChange={setCommanders}
        value={decklist}
        onChange={setDecklist}
        onAnalyze={onAnalyze}
        loading={loading}
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
          <ReportView data={data} />
        </div>
      )}
    </main>
  );
}
