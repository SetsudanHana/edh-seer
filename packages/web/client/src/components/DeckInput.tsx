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
    <div className="flex flex-col gap-2">
      <TextArea
        aria-label="Commander(s)"
        placeholder={"1 Krenko, Mob Boss  (optional — or use a 'Commander' section in the decklist)"}
        rows={2}
        value={commanders}
        onChange={(e) => onCommandersChange(e.target.value)}
      />
      <TextArea
        aria-label="Decklist"
        placeholder={"1 Impact Tremors\n1 Sol Ring\n..."}
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button variant="primary" isDisabled={loading || value.trim() === ""} onPress={onAnalyze}>
        {loading ? "Analyzing…" : "Analyze"}
      </Button>
    </div>
  );
}
