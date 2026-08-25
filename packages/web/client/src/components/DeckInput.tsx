import { useState } from "react";
import { Button, TextArea } from "@heroui/react";
import { deckExportText } from "../lib/deck-export.js";

export function DeckInput({
  commanders,
  onCommandersChange,
  value,
  onChange,
  onAnalyze,
  loading,
  collapsed,
  onEdit,
}: {
  commanders: string;
  onCommandersChange: (v: string) => void;
  value: string;
  onChange: (v: string) => void;
  onAnalyze: () => void;
  loading: boolean;
  collapsed?: boolean;
  onEdit?: () => void;
}) {
  // Label doubles as the confirmation. A clipboard write has no visible result of its own, and a
  // separate toast is a second surface for a fact that fits on the control that caused it.
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await navigator.clipboard.writeText(deckExportText(commanders, value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (collapsed) {
    const count = value.split("\n").filter((l) => l.trim()).length;
    const cmdName = commanders.split("\n")[0]?.replace(/^\d+\s+/, "").trim();
    return (
      <div className="flex items-center justify-between gap-3 border border-(--border) rounded-(--radius) p-3 bg-(--surface) text-sm">
        <span className="text-(--muted) truncate">
          <span className="stat-num text-(--foreground)">{count}</span> lines
          {cmdName ? <> · {cmdName}</> : null}
        </span>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={() => void onCopy()} className="eyebrow px-3 py-1 rounded-(--radius) border border-(--separator)">{copied ? "Copied" : "Copy decklist"}</button>
          <button type="button" onClick={onEdit} className="eyebrow px-3 py-1 rounded-(--radius) border border-(--separator)">Edit</button>
          <Button variant="primary" isDisabled={loading} onPress={onAnalyze} style={{ backgroundImage: "var(--accent-gradient)" }}>
            {loading ? "Analyzing…" : "Re-analyze"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border border-(--border) rounded-(--radius) p-4 bg-(--surface)">
      <div className="flex flex-col gap-1">
        <label className="eyebrow" htmlFor="commanders-input">
          Commander
        </label>
        <TextArea
          id="commanders-input"
          aria-label="Commander(s)"
          placeholder={"1 Krenko, Mob Boss  (optional — or use a 'Commander' section in the decklist)"}
          rows={2}
          value={commanders}
          onChange={(e) => onCommandersChange(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="eyebrow" htmlFor="decklist-input">
          Decklist
        </label>
        <TextArea
          id="decklist-input"
          aria-label="Decklist"
          placeholder={"1 Impact Tremors\n1 Sol Ring\n..."}
          rows={10}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
        />
      </div>
      <Button
        variant="primary"
        isDisabled={loading || value.trim() === ""}
        onPress={onAnalyze}
        style={{ backgroundImage: "var(--accent-gradient)" }}
      >
        {loading ? "Analyzing…" : "Analyze deck"}
      </Button>
    </div>
  );
}
