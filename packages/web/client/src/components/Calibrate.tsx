/** Judge one pair at a time so a human verdict can become a committed test.
 *  Spec: `docs/superpowers/specs/2026-08-06-pair-calibration-tool-design.md`.
 *
 *  The engine's own reasons are fetched with the pair but HIDDEN until asked for. Seeing what the
 *  engine already believes anchors the answer to it, which is exactly what would make a calibration
 *  set worthless. */
import { useCallback, useEffect, useState } from "react";

type Verdict = "synergy" | "neutral" | "anti-synergy";

interface Card {
  name: string;
  typeLine: string;
  oracleText: string;
  tags: string[];
}

interface Pair {
  a: Card;
  b: Card;
  stratum: "linked" | "shared-tag" | "random";
  engineReasons: string[];
}

const STRATUM_LABEL: Record<Pair["stratum"], string> = {
  linked: "engine links these",
  "shared-tag": "share a theme, no edge",
  random: "random pair",
};

function CardPanel({
  card, flagged, onFlag, note, onNote,
}: {
  card: Card;
  flagged: boolean;
  onFlag: (v: boolean) => void;
  note: string;
  onNote: (v: string) => void;
}) {
  return (
    <section className="flex-1 border border-(--separator) p-4 flex flex-col gap-3 min-w-0">
      <header>
        <h2 className="text-lg font-semibold">{card.name}</h2>
        <p className="text-xs opacity-60">{card.typeLine}</p>
      </header>
      <p className="text-sm whitespace-pre-wrap opacity-90">{card.oracleText}</p>
      <div className="text-xs font-mono opacity-70 flex flex-col gap-1 border-t border-(--separator) pt-2">
        {card.tags.map((t, i) => <span key={i}>{t}</span>)}
      </div>
      <label className="text-xs flex items-center gap-2 mt-auto pt-2">
        <input type="checkbox" checked={flagged} onChange={(e) => onFlag(e.target.checked)} />
        this card is mistagged
      </label>
      {flagged && (
        <input
          className="text-xs bg-transparent border border-(--field-border) px-2 py-1"
          placeholder="what's wrong with it?"
          value={note}
          onChange={(e) => onNote(e.target.value)}
        />
      )}
    </section>
  );
}

export function Calibrate() {
  const [pair, setPair] = useState<Pair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [flags, setFlags] = useState<Record<"a" | "b", { on: boolean; note: string }>>({
    a: { on: false, note: "" }, b: { on: false, note: "" },
  });
  const [note, setNote] = useState("");
  const [count, setCount] = useState<{ total: number; knownDefects: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setShowReasons(false);
    setFlags({ a: { on: false, note: "" }, b: { on: false, note: "" } });
    setNote("");
    try {
      const res = await fetch("/api/calibrate/pair");
      // A 404 IS THE TOOL BEING OFF, NOT A FAILURE. The routes are not mounted unless
      // `MTG_CALIBRATE=1` — the verdict route writes the panel's own inputs — so "failed: 404" would
      // send the owner debugging a server that is behaving exactly as configured.
      if (res.status === 404) {
        throw new Error("the calibration tool is not enabled on this server — start it with MTG_CALIBRATE=1");
      }
      if (!res.ok) throw new Error(`pair request failed: ${res.status}`);
      setPair((await res.json()) as Pair);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load a pair");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function judge(verdict: Verdict) {
    if (!pair) return;
    const tagDefects = (["a", "b"] as const)
      .filter((k) => flags[k].on)
      .map((k) => ({ card: pair[k].name, note: flags[k].note }));
    try {
      const res = await fetch("/api/calibrate/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          a: pair.a.name, b: pair.b.name, verdict, stratum: pair.stratum,
          ...(tagDefects.length ? { tagDefects } : {}),
          ...(note ? { note } : {}),
        }),
      });
      if (!res.ok) throw new Error(`verdict failed: ${res.status}`);
      setCount((await res.json()) as { total: number; knownDefects: number });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to record the verdict");
    }
  }

  if (error) {
    return (
      <div className="p-8 flex flex-col gap-3">
        <p className="text-(--danger) text-sm">{error}</p>
        <button className="border border-(--separator) px-3 py-1 text-sm w-fit" onClick={() => void load()}>retry</button>
      </div>
    );
  }
  if (!pair) return <p className="p-8 text-sm opacity-60">sampling a pair…</p>;

  return (
    <main className="min-h-screen bg-background text-foreground p-8 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Pair calibration</h1>
        <p className="text-xs opacity-60">
          {STRATUM_LABEL[pair.stratum]}
          {count && ` · ${count.total} judged, ${count.knownDefects} known defects`}
        </p>
      </header>

      <div className="flex gap-4 items-stretch">
        <CardPanel
          card={pair.a}
          flagged={flags.a.on}
          onFlag={(on) => setFlags((f) => ({ ...f, a: { ...f.a, on } }))}
          note={flags.a.note}
          onNote={(n) => setFlags((f) => ({ ...f, a: { ...f.a, note: n } }))}
        />
        <CardPanel
          card={pair.b}
          flagged={flags.b.on}
          onFlag={(on) => setFlags((f) => ({ ...f, b: { ...f.b, on } }))}
          note={flags.b.note}
          onNote={(n) => setFlags((f) => ({ ...f, b: { ...f.b, note: n } }))}
        />
      </div>

      <input
        className="text-sm bg-transparent border border-(--field-border) px-3 py-2"
        placeholder="note about the pair (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="flex gap-3">
        <button className="border border-(--success) text-(--success) px-4 py-2 text-sm" onClick={() => void judge("synergy")}>
          synergy
        </button>
        <button className="border border-(--separator) px-4 py-2 text-sm" onClick={() => void judge("neutral")}>
          neutral
        </button>
        <button className="border border-(--danger) text-(--danger) px-4 py-2 text-sm" onClick={() => void judge("anti-synergy")}>
          anti-synergy
        </button>
        <button className="border border-(--separator) px-4 py-2 text-sm ml-auto opacity-70" onClick={() => void load()}>
          skip
        </button>
      </div>

      <section className="border-t border-(--separator) pt-3">
        {showReasons ? (
          <div className="text-xs font-mono opacity-70 flex flex-col gap-1">
            {pair.engineReasons.length === 0
              ? <span>(the engine finds no edge)</span>
              : pair.engineReasons.map((r, i) => <span key={i}>{r}</span>)}
          </div>
        ) : (
          <button className="text-xs underline opacity-50" onClick={() => setShowReasons(true)}>
            show what the engine thinks (after you decide)
          </button>
        )}
      </section>
    </main>
  );
}
