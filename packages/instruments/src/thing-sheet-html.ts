import { SHEET_CSS, sheetScript } from "./rejudge-sheet-html.js";

/** The interactive half of `thing-sheet.ts`: one self-contained page for a claim type the panel
 *  cannot hold — "does this card do the deck's thing".
 *
 *  ONE CARD, NOT TWO. The pairwise sheet shows producer and consumer with an arrow between them;
 *  here there is a deck, a theme phrase, and a single card. Reusing that markup would print the
 *  words "producer" and "consumer" on a sheet where neither is true, so the CSS and the interaction
 *  are shared and the markup is not.
 *
 *  IT SHOWS NO STRATUM AND NO TAG. The reader must not be able to tell whether the engine counted
 *  the card — that is the whole measurement. `Calibrate.tsx` settled the anchoring rule and the
 *  cost-reduction sheet re-learned it: the last thing read before clicking must be the CLAIM, never
 *  what the engine already believes. */

export interface ThingSheetRow {
  deck: string; card: string; theme: string;
  cost: string; typeLine: string; oracle: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pips = (cost: string): string =>
  cost ? [...cost.matchAll(/\{([^{}]+)\}/g)].map((m) => `<span class="pip">${esc(m[1])}</span>`).join("")
       : `<span class="pip pip-none">no cost</span>`;

/** The record a filled sheet emits — the same shape `thing-sheet.ts --score` reads, minus the
 *  fields the page must not show (`stratum`, `tag`), which it rejoins by (deck, card). */
const LINE_BUILDER = `    function line(i) {
      return JSON.stringify({
        deck: rows[i].deck, card: rows[i].card,
        verdict: verdicts[i],
        note: notes[i] || ""
      });
    }
`;

export function renderThingSheet(rows: ThingSheetRow[], seed: number): string {
  const claims = rows.map((r, i) => `
    <article class="claim" id="claim-${i}" data-index="${i}">
      <header class="claim-head">
        <span class="num">${i + 1}<span class="of">/${rows.length}</span></span>
        <div class="claim-title">
          <h2>${esc(r.card)}</h2>
          <p class="meta"><span class="deck">${esc(r.deck)}</span></p>
        </div>
        <span class="state" data-state="unjudged">unjudged</span>
      </header>

      <div class="cards">
        <div class="card" data-role="card">
          <div class="card-head">
            <span class="role">the card</span>
            <span class="cost">${pips(r.cost)}</span>
          </div>
          <h3 class="card-name">${esc(r.card)}</h3>
          <p class="type-line">${esc(r.typeLine)}</p>
          <div class="oracle">${esc(r.oracle).split("\n").map((l) => `<p>${l}</p>`).join("")}</div>
        </div>
      </div>

      <div class="claim-sentence">
        <span class="ask">Does this card do the deck's thing?</span>
        <p class="sentence">This deck's thing is <strong>${esc(r.theme)}</strong>. ${esc(r.card)} counts toward it.</p>
      </div>

      <div class="verdicts" role="group" aria-label="Verdict for claim ${i + 1}">
        <button type="button" class="v v-real" data-v="real">real</button>
        <button type="button" class="v v-false" data-v="false">false</button>
        <button type="button" class="v v-uncertain" data-v="uncertain">uncertain</button>
        <input type="text" class="why" placeholder="why (optional, goes in the note)" aria-label="Note for claim ${i + 1}" />
      </div>
    </article>`).join("");

  return `<title>Does the deck do its thing? — ${rows.length} claims</title>
${SHEET_CSS}
<div class="wrap">
  <header class="masthead">
    <div>
      <span class="kicker">blind draw &middot; seed ${seed}</span>
      <h1>Does this card do the deck's thing?</h1>
      <p class="sub">${rows.length} claims over ${new Set(rows.map((r) => r.deck)).size} decks, shuffled.
      The sheet does not say whether the engine counted the card, and the order carries no signal —
      both on purpose.</p>
    </div>
    <p class="sub"><strong>real</strong> if the card genuinely does the named thing ·
    <strong>false</strong> if it does not · <strong>uncertain</strong> if the question is wrong for
    this card. Judge the CARD against the THEME, not against how good the card is.</p>
  </header>
  ${claims}
  <details class="out"><summary>the JSONL this page has built</summary><pre id="json">judge a claim to start</pre></details>
</div>

<div class="dock">
  <span class="progress"><span id="done">0</span> / ${rows.length}</span>
  <span class="bar"><i id="fill"></i></span>
  <button type="button" id="copy" disabled>copy JSONL</button>
  <button type="button" class="ghost" id="reset">reset</button>
</div>

<script id="rows" type="application/json">${JSON.stringify(rows.map((r) => ({ deck: r.deck, card: r.card }))).replace(/</g, "\\u003c")}</script>
${sheetScript(LINE_BUILDER)}
`;
}
