import { Button, TextArea } from "@heroui/react";

export function DeckInput({
  value,
  onChange,
  onAnalyze,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onAnalyze: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <TextArea
        aria-label="Decklist"
        placeholder={"1 Krenko, Mob Boss\n1 Impact Tremors\n..."}
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        variant="primary"
        isDisabled={loading || value.trim() === ""}
        onPress={onAnalyze}
      >
        {loading ? "Analyzing…" : "Analyze"}
      </Button>
    </div>
  );
}
