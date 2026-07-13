import { useState } from "react";
import { analyzeDeck } from "./api.js";
import type { AnalyzeResponse } from "./types.js";
import { DeckInput } from "./components/DeckInput.js";
import { ReportView } from "./components/ReportView.js";

export default function App() {
  const [commanders, setCommanders] = useState("");
  const [decklist, setDecklist] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <main className="min-h-screen bg-background text-foreground p-8 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-bold">MTG Synergy — Deck Analyzer</h1>
      <DeckInput
        commanders={commanders}
        onCommandersChange={setCommanders}
        value={decklist}
        onChange={setDecklist}
        onAnalyze={onAnalyze}
        loading={loading}
      />
      {error && <div className="text-danger border border-danger rounded p-3 text-sm">{error}</div>}
      {data && <ReportView data={data} />}
    </main>
  );
}
