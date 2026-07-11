import type { Card } from "@mtg/engine";

export interface ScryfallCard {
  oracle_id?: string;
  name?: string;
  type_line?: string;
  oracle_text?: string;
  keywords?: string[];
  colors?: string[];
  cmc?: number;
  card_faces?: Array<{ oracle_text?: string; colors?: string[] }>;
}

export interface NormalizedCard {
  oracleId: string;
  card: Card;
  faceNames: string[];
}

export function normalizeScryfallCard(raw: ScryfallCard): NormalizedCard | null {
  if (!raw.oracle_id || !raw.name || !raw.type_line) return null;

  const faces = raw.card_faces ?? [];

  const oracleText =
    raw.oracle_text ??
    (faces.length > 0
      ? faces.map((f) => f.oracle_text ?? "").join("\n//\n")
      : "");

  let colors = raw.colors ?? [];
  if (colors.length === 0 && faces.length > 0) {
    colors = Array.from(new Set(faces.flatMap((f) => f.colors ?? [])));
  }

  const faceNames =
    raw.name.includes(" // ") ? raw.name.split(" // ").map((s) => s.trim()) : [];

  const card: Card = {
    name: raw.name,
    typeLine: raw.type_line,
    oracleText,
    keywords: raw.keywords ?? [],
    colors,
    manaValue: raw.cmc ?? 0,
  };

  return { oracleId: raw.oracle_id, card, faceNames };
}
