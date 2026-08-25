/** The interactive half of `agreement-sample.ts`: the BLIND judging page for a judge-agreement draw.
 *
 *  Chrome (CSS, verdict buttons, progress, JSONL export, the three-rung clipboard) is shared with
 *  the re-judge sheet — `SHEET_CSS` and `sheetScript` exist for exactly this. The MARKUP is its own,
 *  for one reason that matters more here than anywhere else:
 *
 *  **NOTHING CACHED IS ON THIS PAGE.** `renderSheet` ships a folded `<details>` carrying the cached
 *  verdict, which is right for a re-judge and fatal for a blind draw — the whole measurement is the
 *  gap between the owner's rubric and mine, and a page that whispers mine measures memory instead.
 *  There is no stratum marker either: the draw is shuffled and the strata are sealed in `key.json`.
 *
 *  The verdict vocabulary is `true` / `false` / `partial`, NOT the panel's real/false/uncertain.
 *  Rounds 1-3 were answered in those three words and `partial` is load-bearing: it is what separates
 *  the strict rate from the lenient one, and round 3's REAL stratum was 4.4% strict / 0.0% lenient
 *  entirely on that distinction.
 */
import { SHEET_CSS, sheetScript, type SheetCard } from "./rejudge-sheet-html.js";

export interface AgreementRow {
  id: number;
  producer: SheetCard;
  consumer: SheetCard;
  tag: string;
  claim: string;
  decks: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pips = (cost: string): string =>
  cost
    ? [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => `<span class="pip">${esc(m[1])}</span>`).join("")
    : `<span class="pip pip-none">no cost</span>`;

const cardPanel = (c: SheetCard, role: string): string => `
      <div class="card" data-role="${role}">
        <div class="card-head">
          <span class="role">${role}</span>
          <span class="cost">${pips(c.cost)}</span>
        </div>
        <h3 class="card-name">${esc(c.name)}</h3>
        <p class="type-line">${esc(c.typeLine)}${c.colors.length ? ` <span class="colors">${esc(c.colors.join(""))}</span>` : ""}</p>
        <div class="oracle">${esc(c.oracle).split("\n").map((l) => `<p>${l}</p>`).join("")}</div>
      </div>`;

/** The record the page writes per judged row. `id` is what `--score` joins on, never the position
 *  in the export — a partly-judged sheet exports a subset and position would silently re-key it. */
const LINE_BUILDER = `    function line(i) {
      return JSON.stringify({ id: rows[i].id, verdict: verdicts[i], note: notes[i] || "" });
    }
`;

export function renderAgreementSheet(rows: AgreementRow[], round: string): string {
  const claims = rows.map((r, i) => `
    <article class="claim" id="claim-${i}" data-index="${i}">
      <header class="claim-head">
        <span class="num">${i + 1}<span class="of">/${rows.length}</span></span>
        <div class="claim-title">
          <h2>${esc(r.producer.name)} <span class="arrow">&rarr;</span> ${esc(r.consumer.name)}</h2>
          <p class="meta"><code>${esc(r.tag)}</code> &middot; seen in ${r.decks.map((d) => `<span class="deck">${esc(d)}</span>`).join(" ")}</p>
        </div>
        <span class="state" data-state="unjudged">unjudged</span>
      </header>

      <div class="cards">${cardPanel(r.producer, "producer")}${cardPanel(r.consumer, "consumer")}</div>

      <div class="claim-sentence">
        <span class="ask">Is this true of these two cards?</span>
        <p class="sentence">${esc(r.claim)}</p>
      </div>

      <div class="verdicts" role="group" aria-label="Verdict for claim ${i + 1}">
        <button type="button" class="v v-real" data-v="true">true</button>
        <button type="button" class="v v-false" data-v="false">false</button>
        <button type="button" class="v v-uncertain" data-v="partial">partial</button>
        <input type="text" class="why" placeholder="why (a reason on a disagreement is worth more than the verdict)" aria-label="Note for claim ${i + 1}" />
      </div>
    </article>`).join("");

  return `<title>Blind draw ${esc(round)}</title>
${SHEET_CSS}

<div class="wrap">
  <header class="masthead">
    <div>
      <span class="kicker">judge agreement &middot; ${esc(round)} &middot; blind</span>
      <h1>${rows.length} claims, no verdict shown</h1>
      <p class="sub">Judge the <em>sentence</em> &mdash; is it true of those two cards? Not whether the synergy is
        interesting, and not whether the engine should make the claim. <em>partial</em> is a real answer:
        it is what separated round 3's strict rate from its lenient one. What the engine already believes
        is sealed in <code>key.json</code> and is not on this page.</p>
    </div>
  </header>
  ${claims}
</div>

<div class="out">
  <details>
    <summary>JSONL output</summary>
    <pre id="json">judge a claim to start</pre>
  </details>
</div>

<div class="dock">
  <span class="progress"><span id="done">0</span> / ${rows.length}</span>
  <span class="bar"><i id="fill"></i></span>
  <button type="button" id="copy" disabled>copy JSONL</button>
  <button type="button" class="ghost" id="reset">reset</button>
</div>

<script id="rows" type="application/json">${JSON.stringify(rows.map((r) => ({ id: r.id }))).replace(/</g, "\\u003c")}</script>
${sheetScript(LINE_BUILDER)}
`;
}
