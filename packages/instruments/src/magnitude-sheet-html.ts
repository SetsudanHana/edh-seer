/** THE RANKING SHEET FOR THE MAGNITUDE MEASUREMENT: one payoff and three feeders per row, the owner
 *  ranks the feeders 1/2/3 (a tie shares a number), the page writes the JSONL itself. Self-contained
 *  like the other sheets: no font, script or stylesheet fetched from anywhere. The engine's own
 *  orderings are NOT on the page -- they sit in the sealed key. */
import { SHEET_CSS, cardPanel, esc, type SheetCard } from "./rejudge-sheet-html.js";

export interface MagnitudeRow { id: number; deck: string; payoff: SheetCard; feeders: SheetCard[] }

export function renderMagnitudeSheet(rows: MagnitudeRow[], title: string): string {
  const feeder = (i: number, f: SheetCard, k: number): string => `
      <div class="feeder" data-row="${i}" data-feeder="${k}">
        ${cardPanel(f, `feeder ${k + 1}`)}
        <div class="verdicts" role="group" aria-label="Rank of ${esc(f.name)} for row ${i + 1}">
          <button type="button" class="v v-real" data-rank="1">1 · feeds it most</button>
          <button type="button" class="v" data-rank="2">2</button>
          <button type="button" class="v v-false" data-rank="3">3 · least</button>
        </div>
      </div>`;
  const body = rows.map((r, i) => `
    <article class="claim" id="claim-${i}" data-index="${i}">
      <header class="claim-head">
        <span class="num">${i + 1}<span class="of">/${rows.length}</span></span>
        <div class="claim-title">
          <h2>${esc(r.payoff.name)}</h2>
          <p class="meta">in <span class="deck">${esc(r.deck)}</span> &middot; which of these three feeds it most?</p>
        </div>
        <span class="state" data-state="unjudged">unranked</span>
      </header>
      <div class="cards">${cardPanel(r.payoff, "payoff")}</div>
      <div class="claim-sentence"><span class="ask">Rank the three feeders by how much they matter to ${esc(r.payoff.name)} in this deck. Same number = a tie.</span></div>
      <div class="cards feeders">${r.feeders.map((f, k) => feeder(i, f, k)).join("")}</div>
      <input type="text" class="why" placeholder="why (optional)" aria-label="Note for row ${i + 1}" />
    </article>`).join("\n");
  return `<!doctype html><html lang="en"><head><title>${esc(title)}</title>${SHEET_CSS}
<style>.feeders{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.feeder .verdicts{margin-top:8px}</style></head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="intro">${rows.length} payoffs, three feeders each. Rank every feeder; the output box fills as you go. Copy it into <code>rankings.jsonl</code> beside the worksheet.</p>
  <div class="progress-bar"><div id="fill" class="fill"></div></div>
  <span class="progress"><span id="done">0</span> / ${rows.length}</span>
${body}
  <section class="output"><h2>rankings.jsonl</h2><button type="button" id="copy">copy</button> <span id="flash"></span><pre id="out"></pre></section>
</main>
<script id="rows" type="application/json">${JSON.stringify(rows.map((r) => ({ id: r.id, feeders: r.feeders.map((f) => f.name) })))}</script>
<script>
  (function () {
    var rows = JSON.parse(document.getElementById("rows").textContent);
    var ranks = {}; var notes = {};
    function complete(i) { var r = ranks[i] || {}; return r[0] !== undefined && r[1] !== undefined && r[2] !== undefined; }
    function line(i) { return JSON.stringify({ id: rows[i].id, ranks: [ranks[i][0], ranks[i][1], ranks[i][2]], note: notes[i] || "" }); }
    function refresh() {
      var done = Object.keys(ranks).filter(complete).sort(function (a, b) { return a - b; });
      document.getElementById("done").textContent = String(done.length);
      document.getElementById("fill").style.width = (done.length / rows.length * 100) + "%";
      document.getElementById("out").textContent = done.map(line).join("\\n");
    }
    document.querySelectorAll(".feeder").forEach(function (el) {
      var i = Number(el.dataset.row), k = Number(el.dataset.feeder);
      el.querySelectorAll(".v").forEach(function (btn) {
        btn.addEventListener("click", function () {
          ranks[i] = ranks[i] || {};
          var v = Number(btn.dataset.rank);
          if (ranks[i][k] === v) { delete ranks[i][k]; } else { ranks[i][k] = v; }
          el.querySelectorAll(".v").forEach(function (b) { b.setAttribute("aria-pressed", String(ranks[i][k] === Number(b.dataset.rank))); });
          var art = document.getElementById("claim-" + i); var state = art.querySelector(".state");
          art.dataset.judged = complete(i) ? "1" : "0"; state.dataset.state = complete(i) ? "real" : "unjudged"; state.textContent = complete(i) ? "ranked" : "unranked";
          refresh();
        });
      });
    });
    document.querySelectorAll(".why").forEach(function (inp) {
      var i = Number(inp.closest(".claim").dataset.index);
      inp.addEventListener("input", function (e) { notes[i] = e.target.value.trim(); refresh(); });
    });
    var flash = function (t) { document.getElementById("flash").textContent = t; };
    document.getElementById("copy").addEventListener("click", function () {
      var text = document.getElementById("out").textContent;
      var fallback = function () { var range = document.createRange(); range.selectNodeContents(document.getElementById("out")); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); flash("selected \\u2014 press Cmd/Ctrl+C"); };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { flash("copied"); }, fallback); } else { fallback(); }
    });
    refresh();
  })();
</script>
</body></html>`;
}
