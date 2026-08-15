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
 *
 * WITHOUT A HEADER, THE FIRST BLOCK IS THE COMMANDER. Every plain-text EDH export writes the
 * commander first, a blank line, then the 99 — and requiring the header meant `commanders` came back
 * EMPTY for all 71 calibration decks, which is how `SubjectFilter.commander` shipped with its
 * producer side unable to fire even once (2026-08-15). Measured over those files before this rule was
 * written: 67 have a one-card first block and 4 have two — the partner pairs — and NOT ONE has three
 * or more, so the shape is the convention rather than a coincidence.
 *
 * Guarded narrowly, because reading a deck's first card as its commander when it is not would be a
 * silent, deck-wide error: it applies ONLY when no explicit header appeared anywhere, the first block
 * is 1-2 cards, a blank line follows it, and more cards follow that. A list with no blank line, or
 * whose first block is longer, is left exactly as it was.
 */
export function parseDecklistSections(text: string): { commanders: string[]; deck: string[] } {
  const commanders: string[] = [];
  const deck: string[] = [];
  let section: Section = "deck";
  let sawBlankAfterCommander = false;
  // Whether any explicit section header appeared. An export that names its sections is authoritative
  // and must never be second-guessed by the headerless rule below.
  let sawHeader = false;

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
      sawHeader = true;
      sawBlankAfterCommander = false;
      continue;
    }
    if (header === "deck" || header === "mainboard" || header === "main") {
      section = "deck";
      sawHeader = true;
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

  if (commanders.length > 0 || sawHeader) return { commanders, deck };
  return implicitCommanderBlock(text) ?? { commanders, deck };
}

/** The headerless convention: commander(s), blank line, the 99. Returns undefined unless the text
 *  has exactly that shape, so an ordinary list is never reinterpreted. */
function implicitCommanderBlock(text: string): { commanders: string[]; deck: string[] } | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => !l.startsWith("#") && !l.startsWith("//"));
  const firstBlank = lines.findIndex((l, i) => l === "" && lines.slice(0, i).some((x) => x !== ""));
  if (firstBlank === -1) return undefined;
  const head = lines.slice(0, firstBlank).filter((l) => l !== "");
  const tail = lines.slice(firstBlank).filter((l) => l !== "");
  // 1-2 cards is a commander or a partner pair; three is a decklist that happens to have a blank
  // line, and guessing there would mislabel two real deck cards.
  if (head.length < 1 || head.length > 2 || tail.length === 0) return undefined;
  const expand = (ls: string[]): string[] => ls.flatMap((l) => {
    const name = cleanCardLine(l);
    return name ? Array.from({ length: cardQty(l) }, () => name) : [];
  });
  const commanders = expand(head);
  if (commanders.length === 0) return undefined;
  return { commanders, deck: expand(tail) };
}
