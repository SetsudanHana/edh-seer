/** THE CLICK-THROUGH SHEET FOR CARD QUALITY PER ROLE (owner, 2026-09-27: "prepare me some html I can
 *  click through"). Per role, the cards players touch most in precons, in our order; per card the owner
 *  says the position is right, or the card belongs higher or lower, or is not this role at all, with an
 *  optional note. The page writes `quality-verdicts.jsonl` itself (copy or download) and keeps progress
 *  in the browser between visits. Self-contained like the other sheets: nothing fetched. */
import { SHEET_CSS, esc } from "./rejudge-sheet-html.js";

export interface QualitySheetCard {
  name: string; cost: string; typeLine: string; oracle: string;
  /** Our percentile in this role, 0-100. */
  percentile: number;
  ingredients: Record<string, number>;
  /** How many EDHREC precon add/cut lists name the card. */
  preconLists: number;
}
export interface QualitySheetRole { role: string; fallback: boolean; note: string; cards: QualitySheetCard[] }

export const VERDICTS = [
  { key: "higher", label: "↑ higher", cls: "v-uncertain" },
  { key: "right", label: "✓ right", cls: "v-real" },
  { key: "lower", label: "↓ lower", cls: "v-uncertain" },
  { key: "not-role", label: "✗ not this role", cls: "v-false" },
] as const;

export function renderQualitySheet(roles: QualitySheetRole[], title: string): string {
  const total = roles.reduce((n, r) => n + r.cards.length, 0);
  const nav = roles.map((r) => `<a href="#role-${esc(r.role)}">${esc(r.role)} <span class="count" data-role-count="${esc(r.role)}">0/${r.cards.length}</span></a>`).join("");
  const sections = roles.map((r) => `
  <section class="role" id="role-${esc(r.role)}">
    <h2>${esc(r.role)}${r.fallback ? ' <span class="tag">fallback</span>' : ' <span class="tag fit">fitted</span>'}</h2>
    <p class="note">${esc(r.note)}</p>
    ${r.cards.map((c, i) => `
    <article class="claim qrow" data-role="${esc(r.role)}" data-card="${esc(c.name)}" data-judged="0">
      <div class="qhead">
        <span class="rank">${i + 1}</span>
        <div class="qname">
          <details><summary><b>${esc(c.name)}</b> <span class="cost">${esc(c.cost)}</span> <span class="type">${esc(c.typeLine)}</span></summary><p class="oracle">${esc(c.oracle).replace(/\n/g, "<br>")}</p></details>
          <div class="ing">${Object.entries(c.ingredients).map(([k, v]) => `<span>${esc(k)} <b>${v}</b></span>`).join("")}</div>
        </div>
        <div class="pct" title="our percentile in ${esc(r.role)}">${c.percentile}<small>th</small></div>
        <div class="usage" title="EDHREC precon add/cut lists naming it">${c.preconLists}×</div>
      </div>
      <div class="verdicts" role="group" aria-label="Verdict for ${esc(c.name)} in ${esc(r.role)}">
        ${VERDICTS.map((v) => `<button type="button" class="v ${v.cls}" data-v="${v.key}" aria-pressed="false">${v.label}</button>`).join("")}
        <input class="why" type="text" placeholder="why (optional)" aria-label="Note for ${esc(c.name)}">
      </div>
    </article>`).join("")}
  </section>`).join("");
  return `<!doctype html><html lang="en"><head>${SHEET_CSS}
<title>${esc(title)}</title>
<style>
  .rolenav { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: .35rem .9rem; padding: .6rem 0; background: var(--ground); border-bottom: 1px solid var(--rule); font-family: var(--mono); font-size: .78rem; }
  .rolenav a { color: var(--steel); text-decoration: none; }
  .rolenav .count { color: var(--soft); }
  .role h2 { font-family: var(--serif); margin: 1.6rem 0 .2rem; }
  .role .note { color: var(--soft); font-size: .85rem; margin: 0 0 .8rem; }
  .tag { font-family: var(--mono); font-size: .65rem; letter-spacing: .06em; text-transform: uppercase; color: var(--uncertain); border: 1px solid currentColor; border-radius: 3px; padding: .1rem .35rem; vertical-align: middle; }
  .tag.fit { color: var(--real); }
  .qrow { padding: .6rem .8rem; margin: 0 0 .5rem; }
  .qhead { display: grid; grid-template-columns: 2rem 1fr auto auto; gap: .8rem; align-items: start; }
  .rank { font-family: var(--mono); color: var(--soft); font-variant-numeric: tabular-nums; padding-top: .15rem; }
  .qname summary { cursor: pointer; }
  .cost, .type { color: var(--soft); font-size: .8rem; }
  .oracle { font-size: .85rem; margin: .4rem 0 0; }
  .ing { display: flex; flex-wrap: wrap; gap: .2rem .7rem; margin-top: .3rem; font-family: var(--mono); font-size: .7rem; color: var(--soft); }
  .pct { font-family: var(--mono); font-size: 1.1rem; font-variant-numeric: tabular-nums; }
  .pct small { font-size: .6rem; color: var(--soft); }
  .usage { font-family: var(--mono); font-size: .75rem; color: var(--soft); padding-top: .2rem; }
  .qrow .verdicts { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .5rem; align-items: center; }
  /* THE SHARED SHEET CSS SETS SMALL-CAPS MONO ON NOTES AND HEADINGS; card names and the role note read
     as prose here. */
  .role .note, .qname, .qname summary, .qname b, .oracle { font-family: var(--sans); text-transform: none; letter-spacing: normal; font-variant: normal; }
  .role .note { font-size: .88rem; }
  .qname b { font-size: 1rem; }
  .ing { text-transform: none; letter-spacing: normal; }
  @media (max-width: 40rem) { .qhead { grid-template-columns: 1.5rem 1fr auto; } .usage { display: none; } }
</style></head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="intro">${total} cards across ${roles.length} roles, each in our order (best first). For each, say whether its place is right, or it belongs higher or lower, or it is not this role at all. Unjudged cards are fine to leave. Progress is kept in this browser; when done, download <code>quality-verdicts.jsonl</code> or copy it.</p>
  <nav class="rolenav">${nav}<span class="progress"><span id="done">0</span> / ${total}</span></nav>
  <div class="progress-bar"><div id="fill" class="fill"></div></div>
${sections}
  <section class="output"><h2>quality-verdicts.jsonl</h2><button type="button" id="copy">copy</button> <button type="button" id="download">download</button> <button type="button" id="reset">clear all</button> <span id="flash"></span><pre id="out"></pre></section>
</main>
<script>
  (function () {
    var KEY = "edhseer-quality-verdicts-v1";
    var state = {};
    try { state = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { state = {}; }
    var rows = Array.prototype.slice.call(document.querySelectorAll(".qrow"));
    var id = function (el) { return el.dataset.role + "\\u0000" + el.dataset.card; };
    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
    function lines() {
      return rows.filter(function (el) { return state[id(el)] && state[id(el)].v; }).map(function (el) {
        var s = state[id(el)];
        return JSON.stringify({ role: el.dataset.role, card: el.dataset.card, rank: Number(el.querySelector(".rank").textContent), verdict: s.v, note: s.note || "" });
      });
    }
    function paint(el) {
      var s = state[id(el)] || {};
      el.querySelectorAll(".v").forEach(function (b) { b.setAttribute("aria-pressed", String(s.v === b.dataset.v)); });
      el.dataset.judged = s.v ? "1" : "0";
      var inp = el.querySelector(".why"); if (inp.value !== (s.note || "")) inp.value = s.note || "";
    }
    function refresh() {
      var out = lines();
      document.getElementById("out").textContent = out.join("\\n");
      document.getElementById("done").textContent = String(out.length);
      document.getElementById("fill").style.width = (out.length / rows.length * 100) + "%";
      document.querySelectorAll("[data-role-count]").forEach(function (c) {
        var role = c.dataset.roleCount;
        var mine = rows.filter(function (el) { return el.dataset.role === role; });
        var judged = mine.filter(function (el) { return state[id(el)] && state[id(el)].v; }).length;
        c.textContent = judged + "/" + mine.length;
      });
    }
    rows.forEach(function (el) {
      paint(el);
      el.querySelectorAll(".v").forEach(function (b) {
        b.addEventListener("click", function () {
          var s = state[id(el)] = state[id(el)] || {};
          s.v = s.v === b.dataset.v ? undefined : b.dataset.v;
          paint(el); save(); refresh();
        });
      });
      el.querySelector(".why").addEventListener("input", function (e) {
        var s = state[id(el)] = state[id(el)] || {};
        s.note = e.target.value.trim(); save(); refresh();
      });
    });
    var flash = function (t) { document.getElementById("flash").textContent = t; setTimeout(function () { document.getElementById("flash").textContent = ""; }, 2500); };
    document.getElementById("copy").addEventListener("click", function () {
      var text = document.getElementById("out").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash("copied"); }, function () { flash("copy failed: select the box"); });
      else flash("select the box and copy");
    });
    document.getElementById("download").addEventListener("click", function () {
      var blob = new Blob([document.getElementById("out").textContent + "\\n"], { type: "application/x-ndjson" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "quality-verdicts.jsonl";
      document.body.appendChild(a); a.click(); a.remove(); flash("downloaded");
    });
    document.getElementById("reset").addEventListener("click", function () {
      if (!document.getElementById("reset").dataset.armed) { document.getElementById("reset").dataset.armed = "1"; flash("click again to clear every verdict"); return; }
      state = {}; save(); rows.forEach(paint); refresh(); delete document.getElementById("reset").dataset.armed; flash("cleared");
    });
    refresh();
  })();
</script>
</body></html>`;
}
