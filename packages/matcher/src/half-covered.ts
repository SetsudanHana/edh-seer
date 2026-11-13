/** THE PERMANENT CLASSES A DECK ANSWERS ONLY WITH NARROW CARDS (owner 2026-11-13): the class has a member
 *  (`count > 0`) and `answerCoverage` reads it at a fraction below 1, so a full answer lifts it and another
 *  narrow card adds 0. Lands are left out like everywhere the answers are listed, and a commander's own
 *  answer is not a card to buy. A leaf with no imports: the web client and the suggester both read it. */
export interface HalfCoveredInput {
  answerCoverage?: { rows: readonly { class: string; fraction?: number }[] };
  deckMath?: { answers: readonly { class: string; count: number; fromCommandZone?: boolean }[] };
}

export function halfCoveredClasses(report: HalfCoveredInput): string[] {
  const rows = report.answerCoverage?.rows ?? [];
  return (report.deckMath?.answers ?? [])
    .filter((a) => a.class !== "graveyard" && a.class !== "land" && a.count > 0 && !a.fromCommandZone)
    .filter((a) => {
      const f = rows.find((r) => r.class === a.class)?.fraction;
      return f !== undefined && f > 0 && f < 1;
    })
    .map((a) => a.class);
}
