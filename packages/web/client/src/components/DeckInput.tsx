import { useState } from "react";
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
  onStartOver,
  shareLink,
}: {
  commanders: string;
  onCommandersChange: (v: string) => void;
  value: string;
  onChange: (v: string) => void;
  onAnalyze: () => void;
  loading: boolean;
  collapsed?: boolean;
  onEdit?: () => void;
  /** Clears the remembered deck and returns to the empty analyser. See the button below. */
  onStartOver?: () => void;
  /** The URL that reproduces the analysis on screen, or null when the deck is too long to encode.
   *  Absent rather than disabled in that case: a button that cannot do its job is worse than none. */
  shareLink?: string | null;
}) {
  // Label doubles as the confirmation. A clipboard write has no visible result of its own, and a
  // separate toast is a second surface for a fact that fits on the control that caused it.
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  async function onCopy() {
    await navigator.clipboard.writeText(deckExportText(commanders, value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyLink() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  if (collapsed) {
    const count = value.split("\n").filter((l) => l.trim()).length;
    const cmdName = commanders.split("\n")[0]?.replace(/^\d+\s+/, "").trim();
    // IT WRAPS, AND AT 390px IT HAS TO. Four controls plus the summary ran 409px wide inside a
    // 390px viewport -- measured `document.body.scrollWidth` 466 against a 390 client width, so 76px
    // of the row sat off-screen and took the whole page's horizontal scroll with it. The cause was
    // `shrink-0` on the button group: correct on a desktop, where it stops the buttons squashing
    // before the summary truncates, and an instruction never to fit on a phone. Wrapping to a second
    // line is what a phone has room for; `justify-between` still puts the summary and the buttons on
    // opposite ends whenever one line is enough.
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-(--separator) rounded-(--radius) p-3 bg-(--surface) text-sm">
        <span className="text-(--muted) truncate">
          <span className="stat-num text-(--foreground)">{count}</span> lines
          {cmdName ? <> · {cmdName}</> : null}
        </span>
        <div className="flex flex-wrap gap-2">
          {/* THE LINK IS THE ANALYSIS, not the decklist: it reopens this exact report rather than
            *  handing someone a list to paste themselves. The address bar already carries it — this
            *  is for the reader who does not think to look there. */}
          {shareLink ? (
            <button
              type="button"
              onClick={() => void copyLink()}
              className="eyebrow px-3 py-1 rounded-(--radius) border border-(--separator)"
            >
              {linkCopied ? "Link copied" : "Copy link"}
            </button>
          ) : null}
          <button type="button" onClick={() => void onCopy()} className="eyebrow px-3 py-1 rounded-(--radius) border border-(--separator)">{copied ? "Copied" : "Copy decklist"}</button>
          <button type="button" onClick={onEdit} className="eyebrow px-3 py-1 rounded-(--radius) border border-(--separator)">Edit</button>
          {/* A WAY BACK TO AN EMPTY PAGE (owner, 2026-09-03: "we do not have way to clear and start
            *  from the beginning"). `Edit` reopens THIS deck; nothing offered a different one, and
            *  the report has no other exit -- the deck is in the hash, so even reloading brings it
            *  back.
            *  NO CONFIRMATION, BECAUSE IT IS NOT LOST: this navigates, so Back returns to the
            *  address the report was at and the hash rebuilds it. `Copy decklist` is also two
            *  buttons to the left. A modal on an action the browser already undoes is a modal that
            *  teaches readers to dismiss modals. */}
          <button type="button" onClick={onStartOver} className="eyebrow px-3 py-1 rounded-(--radius) border border-(--separator)">Start over</button>
          {/* IN-FLIGHT IS NOT DISABLED (components.md rule 8): a button waiting on the analysis
            *  keeps its full strength and says so, because dimming it reads as "you cannot do this"
            *  rather than "this is happening". It still refuses a second submit -- `aria-busy` is
            *  what tells the styling and a screen reader which of the two states this is. */}
          <button
            type="button"
            className="btn-primary"
            disabled={loading}
            aria-busy={loading}
            onClick={onAnalyze}
          >
            {loading ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border border-(--separator) rounded-(--radius) p-4 bg-(--surface)">
      <div className="flex flex-col gap-1">
        <label className="eyebrow" htmlFor="commanders-input">
          Commander
        </label>
        <textarea
          id="commanders-input"
          className="field"
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
        <textarea
          id="decklist-input"
          className="field font-mono"
          aria-label="Decklist"
          placeholder={"1 Impact Tremors\n1 Sol Ring\n..."}
          rows={10}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {/* DISABLED HERE MEANS UNAVAILABLE -- there is no decklist to analyse -- and that is the one
        *  case that earns the dimming. Loading keeps full strength; see the collapsed bar above. */}
      <button
        type="button"
        className="btn-primary"
        disabled={loading || value.trim() === ""}
        aria-busy={loading}
        onClick={onAnalyze}
      >
        {loading ? "Analyzing…" : "Analyze deck"}
      </button>
    </div>
  );
}
