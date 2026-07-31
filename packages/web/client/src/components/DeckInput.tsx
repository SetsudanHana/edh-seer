import { Button, TextArea } from "@heroui/react";

export function DeckInput({
  commanders,
  onCommandersChange,
  value,
  onChange,
  onAnalyze,
  loading,
}: {
  commanders: string;
  onCommandersChange: (v: string) => void;
  value: string;
  onChange: (v: string) => void;
  onAnalyze: () => void;
  loading: boolean;
}) {
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
      <Button variant="primary" isDisabled={loading || value.trim() === ""} onPress={onAnalyze}>
        {loading ? "Analyzing…" : "Analyze deck"}
      </Button>
    </div>
  );
}
