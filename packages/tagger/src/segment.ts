/** Mechanical clause segmentation of oracle text — no LLM.
 *
 *  The extraction experiment measured where nondeterminism actually lives: across two identical
 *  runs only 55% of cards produced the same STRUCTURE, while the corpus-wide verb set was
 *  byte-identical. The instability is segmentation — how many abilities the model splits a card
 *  into and how it groups them. So we take that decision away from it: split here, deterministically,
 *  and hand the model a numbered list of clauses it must fill in one-for-one.
 *
 *  This also gives a completeness check we have never had. A clause that produces no record is an
 *  error rather than silence, which is the class of bug that let Bitterblossom sit in the corpus
 *  with zero abilities, indistinguishable from a vanilla bear. */

export type ClauseKind =
  | "ability"        // ordinary rules text
  | "keyword"        // printed keywords only ("Flying, first strike", "Ward {2}")
  | "mode"           // one bullet of a modal ability
  | "chapter"        // Saga chapter ("I —", "II, III —")
  | "level"          // Class level marker ("{3}{W}: Level 2")
  | "reminder";      // parenthetical reminder text only

export interface Clause {
  /** 1-based, stable within a card — the slot id the model must fill. */
  id: number;
  kind: ClauseKind;
  /** The clause text with reminder parentheses removed. */
  text: string;
  /** Ability-word or chapter/level marker stripped from the front, if any. */
  marker?: string;
  /** For a mode, the id of the clause introducing "choose one —". */
  parentId?: number;
  /** Derived here, not asked of the model: it disagreed with itself on 3 of 20 cards over a
   *  question with a mechanical answer (is Path to Exile's text a spell ability?). */
  abilityType?: "spell" | "activated" | "triggered" | "static";
  /** The activation cost, when the clause is "{cost}: effect". Split off so the model cannot
   *  choose between recording a sacrifice cost as prose or as an action — Phyrexian Tower's
   *  "{T}, Sacrifice a creature:" is what an aristocrats deck needs to see. */
  cost?: string;
}

/** True when the card itself is an instant or sorcery — its text is a spell ability by default. */
function isSpellCard(typeLine: string): boolean {
  return /\b(instant|sorcery)\b/i.test(typeLine);
}

/** Leading "{cost}: effect" or "Cost, Cost: effect" — an activated ability (CR 602). */
const ACTIVATED = /^((?:\{[^}]*\}|[^:{}]{1,40}?)(?:\s*,\s*(?:\{[^}]*\}|[^:{}]{1,40}?))*)\s*:\s+/;

function classify(text: string, kind: ClauseKind, typeLine: string): { abilityType?: Clause["abilityType"]; cost?: string; body: string } {
  if (kind === "keyword" || kind === "reminder") return { body: text };
  const act = text.match(ACTIVATED);
  // Require the prefix to look like a cost: it must contain a mana symbol, {T}, or a cost word.
  if (act && /\{|sacrifice|discard|pay|remove|exile|tap\b/i.test(act[1])) {
    return { abilityType: "activated", cost: act[1].trim(), body: text.slice(act[0].length) };
  }
  if (/^(when|whenever|at the beginning|at end)/i.test(text)) return { abilityType: "triggered", body: text };
  if (kind === "chapter" || kind === "level") return { abilityType: "triggered", body: text };
  return { abilityType: isSpellCard(typeLine) ? "spell" : "static", body: text };
}

const CHAPTER = /^([IVX]+(?:\s*,\s*[IVX]+)*)\s*[—-]\s*/;
const ABILITY_WORD = /^([A-Z][A-Za-z' ]{2,24})\s*—\s*/;
const LEVEL = /^\{[^}]*\}(?:\s*\{[^}]*\})*\s*:\s*Level\s+\d+/i;

/** Strip reminder text but remember whether anything else remained. */
function stripReminder(line: string): string {
  return line.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Is every comma-separated part of this line a printed keyword of the card? Keywords take
 *  arguments ("protection from Demons", "ward {2}"), so match on a part STARTING WITH one. */
function isKeywordLine(line: string, keywords: string[]): boolean {
  if (line === "") return false;
  const kw = keywords.map((k) => k.toLowerCase());
  return line
    .toLowerCase()
    .split(/,\s*/)
    .every((part) => kw.some((k) => part.trim() === k || part.trim().startsWith(`${k} `)));
}

/** Split a card's oracle text into numbered clauses. Deterministic: the same text always yields
 *  the same clause list, which is the property the LLM could not provide. */
export function segment(oracleText: string, keywords: string[] = [], typeLine = ""): Clause[] {
  const out: Clause[] = [];
  let id = 0;
  const next = (c: Omit<Clause, "id">): Clause => {
    const { abilityType, cost, body } = classify(c.text, c.kind, typeLine);
    const clause: Clause = { id: ++id, ...c, text: body, ...(abilityType ? { abilityType } : {}), ...(cost ? { cost } : {}) };
    out.push(clause);
    return clause;
  };

  for (const rawLine of (oracleText ?? "").split("\n")) {
    const raw = rawLine.trim();
    if (raw === "") continue;
    const line = stripReminder(raw);
    // A line that was ONLY reminder text still gets a slot, so clause ids account for every line.
    if (line === "") { next({ kind: "reminder", text: raw }); continue; }

    let marker: string | undefined;
    let body = line;
    const chapter = body.match(CHAPTER);
    if (chapter) { marker = chapter[1]; body = body.slice(chapter[0].length); }
    else if (LEVEL.test(body)) { next({ kind: "level", text: body }); continue; }
    else {
      const word = body.match(ABILITY_WORD);
      // An ability word ("Landfall —") is a label, not a cost; a "{T}: ..." activated cost is not.
      if (word && !body.startsWith("{")) { marker = word[1].trim(); body = body.slice(word[0].length); }
    }

    // Modal text: "choose one —" then • bullets, which may share the line or be on their own.
    // A bullet-only line attaches to the most recent non-mode clause, so every mode of one modal
    // ability hangs off the same parent however the printing wrapped it.
    if (body.includes("•")) {
      const [head, ...modes] = body.split("•");
      let parentId: number;
      if (head.trim() === "") {
        const prior = [...out].reverse().find((c) => c.kind !== "mode");
        parentId = prior?.id ?? next({ kind: "ability", text: "", marker }).id;
      } else {
        parentId = next({ kind: chapter ? "chapter" : "ability", text: head.trim(), marker }).id;
      }
      for (const m of modes) {
        const t = m.trim();
        if (t) next({ kind: "mode", text: t, parentId });
      }
      continue;
    }

    if (isKeywordLine(body, keywords)) { next({ kind: "keyword", text: body, marker }); continue; }
    next({ kind: chapter ? "chapter" : "ability", text: body, marker });
  }
  return out;
}
