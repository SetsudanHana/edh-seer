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
  return implicitCommanderBlock(text) ?? flatExportCommander(text) ?? { commanders, deck };
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

/** THE FLAT EXPORT: no header, no blank line, and the commander first followed by an ALPHABETICAL
 *  99. Moxfield's plain "1 Samut, the Driving Force (DFT) 367" export has exactly this shape, and
 *  because it carries no blank line the convention rule above cannot fire — so a pasted deck came
 *  back with ZERO commanders. Measured cost of that on the owner's own list (2026-08-18): with no
 *  commander parsed, `COMMANDER_TF_BOOST` never fires, `markCommander` stamps nothing, and
 *  `pressure.ts` prices the commander by draw probability instead of command-zone availability —
 *  the whole cascade CLAUDE.md records for the 71 decks, on every deck a user pastes.
 *
 *  THE SIGNAL IS THE SORT, NOT THE POSITION. "First line is the commander" alone would crown the
 *  first card of any list; what identifies this export is that lines 2..n are in alphabetical order
 *  and the head is NOT — one card deliberately placed outside a sorted list. Verified before the
 *  rule was written: it fires on the owner's file and on **ZERO of the 71 calibration decks**, all
 *  of which carry the blank line and take the path above.
 *
 *  IT UNDER-DETECTS ON PURPOSE. A commander that happens to sort first ("Atraxa" ahead of an
 *  alphabetical 99) does not break the order, so nothing is inferred and the deck reads exactly as
 *  it does today — a missing commander, not a wrong one. Same for an export sorted by type or by
 *  mana value: unsorted tail, no inference. */
function flatExportCommander(text: string): { commanders: string[]; deck: string[] } | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("//"));
  // A real decklist, not a fragment: below this a "sorted list with one card out of order" is as
  // likely to be a scrap of notes as a deck.
  if (lines.length < 30) return undefined;
  const names = lines.map(cleanCardLine).filter(Boolean);
  if (names.length !== lines.length) return undefined;

  // 1 commander or a partner pair, the same 1-2 the blank-line rule allows.
  for (const headCount of [1, 2]) {
    const head = names.slice(0, headCount);
    const tail = names.slice(headCount);
    if (tail.length === 0) continue;
    const lower = tail.map((n) => n.toLowerCase());
    const sorted = lower.every((n, i) => i === 0 || lower[i - 1] <= n);
    if (!sorted) continue;
    // Every head card must sit OUTSIDE the sorted run — that is what marks it as placed, not sorted.
    if (!head.every((h) => h.toLowerCase() > lower[0])) continue;
    const expand = (ls: string[]): string[] => ls.flatMap((l) => {
      const name = cleanCardLine(l);
      return name ? Array.from({ length: cardQty(l) }, () => name) : [];
    });
    return { commanders: expand(lines.slice(0, headCount)), deck: expand(lines.slice(headCount)) };
  }
  return undefined;
}
