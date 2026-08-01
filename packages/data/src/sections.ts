type Section = "commander" | "deck" | "ignore";

function cleanCardLine(line: string): string {
  const withoutQty = line.replace(/^\d+\s*x?\s+/i, "");
  return withoutQty.replace(/\s*[([].*$/, "").trim();
}

/** Leading copy count on a card line ("5 Forest" → 5), clamped to [1, 100]; 1 when absent. */
function cardQty(line: string): number {
  const m = line.match(/^(\d+)\s*x?\s+/i);
  return m ? Math.min(100, Math.max(1, parseInt(m[1], 10))) : 1;
}

/**
 * Split a pasted decklist into commander card names and deck card names.
 * Recognizes section headers as emitted by Moxfield / Archidekt text exports:
 * a line equal to "Commander(s)" starts the commander section; "Deck" / "Mainboard"
 * starts the deck; "Sideboard" / "Maybeboard" / "Tokens" are ignored. Card-line
 * semantics (leading quantity, comments, set/collector suffixes) match parseDecklistText.
 */
export function parseDecklistSections(text: string): { commanders: string[]; deck: string[] } {
  const commanders: string[] = [];
  const deck: string[] = [];
  let section: Section = "deck";
  let sawBlankAfterCommander = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (section === "commander") {
        sawBlankAfterCommander = true;
      }
      continue;
    }

    if (line.startsWith("#") || line.startsWith("//")) continue;

    const header = line.toLowerCase().replace(/[:=]+$/, "").trim();
    if (header === "commander" || header === "commanders") {
      section = "commander";
      sawBlankAfterCommander = false;
      continue;
    }
    if (header === "deck" || header === "mainboard" || header === "main") {
      section = "deck";
      sawBlankAfterCommander = false;
      continue;
    }
    if (header === "sideboard" || header === "maybeboard" || header === "tokens") {
      section = "ignore";
      sawBlankAfterCommander = false;
      continue;
    }

    // If we were in commander section and saw a blank line, implicitly switch to deck
    if (section === "commander" && sawBlankAfterCommander) {
      section = "deck";
      sawBlankAfterCommander = false;
    }

    if (section === "ignore") continue;
    const name = cleanCardLine(line);
    if (!name) continue;
    const target = section === "commander" ? commanders : deck;
    for (let i = 0; i < cardQty(line); i++) target.push(name);
  }

  return { commanders, deck };
}
