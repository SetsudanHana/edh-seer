import { useState } from "react";
import type { TableTalk } from "../lib/table-talk.js";

/** THE LINE TO SAY AT THE TABLE, first thing under the hero, with a Copy button for the group chat.
 *  See `lib/table-talk.ts` for where each clause comes from. */
export function TableTalkLine({ talk }: { talk: TableTalk }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(talk.text);
      setCopied(true);
    } catch { /* no clipboard (an insecure page, a denied permission): the line is still on screen */ }
  };
  return (
    <section aria-labelledby="table-talk" className="flex max-w-3xl flex-col gap-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-4" data-testid="table-talk">
      <h3 id="table-talk" className="eyebrow">Say this at the table</h3>
      <p className="text-base leading-relaxed" data-testid="table-talk-text">{talk.text}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={copy} className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm">
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="text-xs text-(--muted)">The reasons behind each part are in the Bracket, Game plan and Roles chapters.</span>
      </div>
    </section>
  );
}
