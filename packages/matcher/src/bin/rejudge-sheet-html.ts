/** The interactive half of `rejudge-sheet.ts`: one self-contained page that carries the same facts
 *  and writes the JSONL itself, so judging does not mean holding the verdict vocabulary and the
 *  record shape in your head while reading oracle text.
 *
 *  Self-contained on purpose — no font, script or stylesheet fetched from anywhere — so it renders
 *  under a strict CSP and keeps working as a local file. Oracle text is passed through from the
 *  corpus, never retyped. */

export interface SheetCard { name: string; cost: string; typeLine: string; colors: string[]; oracle: string }
export interface SheetRow {
  producer: SheetCard; consumer: SheetCard; tag: string; decks: string[]; claim: string;
  cachedVerdict: string; cause: string; judgedBy: string; note: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Mana symbols as readable pips. The corpus writes them `{2}{G/U}`; a hybrid keeps its slash. */
const pips = (cost: string): string =>
  cost ? [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => `<span class="pip">${esc(m[1])}</span>`).join("") : `<span class="pip pip-none">no cost</span>`;

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

export function renderSheet(rows: SheetRow[], tag: string, want: string): string {
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

      <details class="cached">
        <summary>what was cached (opens what someone already concluded)</summary>
        <span class="cached-verdict">${esc(r.cachedVerdict)} by ${esc(r.judgedBy)}${r.cause ? ` &middot; ${esc(r.cause)}` : ""}</span>
        ${r.note ? `<p class="cached-note">${esc(r.note)}</p>` : ""}
      </details>

      <div class="verdicts" role="group" aria-label="Verdict for claim ${i + 1}">
        <button type="button" class="v v-real" data-v="real">real</button>
        <button type="button" class="v v-false" data-v="false">false</button>
        <button type="button" class="v v-uncertain" data-v="uncertain">uncertain</button>
        <input type="text" class="why" placeholder="why (optional, goes in the note)" aria-label="Note for claim ${i + 1}" />
      </div>
    </article>`).join("");

  return `<title>Re-judge: ${esc(tag)}</title>
<style>
  :root {
    color-scheme: light dark;
    --ground: #f2f3f6; --panel: #ffffff; --ink: #171a21; --soft: #5b6270;
    --rule: #d8dbe2; --steel: #3c5f92; --steel-soft: #e6ecf6;
    --real: #2c7a58; --false: #a83a3c; --uncertain: #8d6415;
    --serif: Iowan Old Style, Palatino, Georgia, serif;
    --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #12141a; --panel: #191c24; --ink: #e7e9ee; --soft: #99a1b0;
      --rule: #2a2f3a; --steel: #8fb0e0; --steel-soft: #1e2735;
      --real: #6fc79b; --false: #e08487; --uncertain: #d8ac5c;
    }
  }
  :root[data-theme="dark"] {
    --ground: #12141a; --panel: #191c24; --ink: #e7e9ee; --soft: #99a1b0;
    --rule: #2a2f3a; --steel: #8fb0e0; --steel-soft: #1e2735;
    --real: #6fc79b; --false: #e08487; --uncertain: #d8ac5c;
  }
  :root[data-theme="light"] {
    --ground: #f2f3f6; --panel: #ffffff; --ink: #171a21; --soft: #5b6270;
    --rule: #d8dbe2; --steel: #3c5f92; --steel-soft: #e6ecf6;
    --real: #2c7a58; --false: #a83a3c; --uncertain: #8d6415;
  }

  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans);
         line-height: 1.5; padding-bottom: 6rem; }
  .wrap { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.25rem 0; }

  .masthead { border-bottom: 2px solid var(--ink); padding-bottom: 1rem; margin-bottom: 2rem;
              display: flex; flex-wrap: wrap; gap: 1rem; align-items: baseline; justify-content: space-between; }
  .masthead h1 { font-family: var(--serif); font-size: 1.9rem; margin: 0; font-weight: 600; text-wrap: balance; }
  .masthead .sub { color: var(--soft); font-size: .85rem; max-width: 42ch; margin: .35rem 0 0; }
  .kicker { font-family: var(--mono); font-size: .7rem; letter-spacing: .12em; text-transform: uppercase;
            color: var(--steel); display: block; margin-bottom: .3rem; }

  .claim { background: var(--panel); border: 1px solid var(--rule); border-radius: 4px;
           margin-bottom: 1.5rem; overflow: hidden; }
  .claim[data-judged="1"] { border-color: var(--steel); }
  .claim-head { display: grid; grid-template-columns: auto 1fr auto; gap: .9rem; align-items: start;
                padding: 1rem 1.1rem; border-bottom: 1px solid var(--rule); }
  .num { font-family: var(--mono); font-size: 1.05rem; color: var(--steel); font-variant-numeric: tabular-nums; }
  .num .of { color: var(--soft); font-size: .75rem; }
  .claim-title h2 { font-family: var(--serif); font-size: 1.05rem; margin: 0; font-weight: 600; text-wrap: balance; }
  .arrow { color: var(--steel); }
  .meta { margin: .25rem 0 0; font-size: .75rem; color: var(--soft); }
  .meta code { font-family: var(--mono); background: var(--steel-soft); padding: .1rem .35rem; border-radius: 3px; }
  .deck { font-family: var(--mono); font-size: .7rem; }
  .state { font-family: var(--mono); font-size: .65rem; letter-spacing: .1em; text-transform: uppercase;
           color: var(--soft); border: 1px solid var(--rule); padding: .2rem .5rem; border-radius: 99px; white-space: nowrap; }
  .state[data-state="real"] { color: var(--real); border-color: var(--real); }
  .state[data-state="false"] { color: var(--false); border-color: var(--false); }
  .state[data-state="uncertain"] { color: var(--uncertain); border-color: var(--uncertain); }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rule); }
  @media (max-width: 40rem) { .cards { grid-template-columns: 1fr; } }
  .card { background: var(--panel); padding: 1rem 1.1rem; }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
  .role { font-family: var(--mono); font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; color: var(--soft); }
  .pip { font-family: var(--mono); font-size: .7rem; border: 1px solid var(--rule); border-radius: 99px;
         padding: .05rem .38rem; margin-left: .15rem; color: var(--ink); }
  .pip-none { border-style: dashed; color: var(--soft); }
  .card-name { font-family: var(--serif); font-size: 1rem; margin: .5rem 0 .15rem; font-weight: 600; }
  .type-line { font-size: .76rem; color: var(--soft); margin: 0 0 .6rem; font-style: italic; }
  .colors { font-family: var(--mono); font-style: normal; }
  .oracle { font-family: var(--serif); font-size: .84rem; }
  .oracle p { margin: 0 0 .45rem; }
  .oracle p:last-child { margin-bottom: 0; }

  .claim-sentence { padding: 1rem 1.1rem; border-top: 1px solid var(--rule); background: var(--steel-soft); }
  .ask { font-family: var(--mono); font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; color: var(--steel); }
  .sentence { font-family: var(--serif); font-size: 1.02rem; margin: .35rem 0 0; text-wrap: balance; }
  .cached { padding: .55rem 1.1rem; border-top: 1px solid var(--rule); font-size: .76rem; }
  .cached summary { font-family: var(--mono); font-size: .68rem; color: var(--soft); cursor: pointer; }
  .cached summary:focus-visible { outline: 2px solid var(--steel); outline-offset: 2px; }
  .cached-verdict { font-family: var(--mono); font-size: .7rem; color: var(--soft); display: block; margin-top: .4rem; }
  .cached-note { margin: .3rem 0 0; color: var(--ink); }

  .verdicts { display: flex; flex-wrap: wrap; gap: .5rem; padding: .9rem 1.1rem 1.1rem; align-items: center; }
  .v { font-family: var(--mono); font-size: .78rem; padding: .45rem 1rem; border-radius: 3px; cursor: pointer;
       background: transparent; border: 1px solid var(--rule); color: var(--ink); }
  .v:hover { border-color: var(--steel); }
  .v:focus-visible { outline: 2px solid var(--steel); outline-offset: 2px; }
  .v[aria-pressed="true"].v-real { background: var(--real); border-color: var(--real); color: var(--panel); }
  .v[aria-pressed="true"].v-false { background: var(--false); border-color: var(--false); color: var(--panel); }
  .v[aria-pressed="true"].v-uncertain { background: var(--uncertain); border-color: var(--uncertain); color: var(--panel); }
  .why { flex: 1 1 14rem; min-width: 10rem; font-family: var(--sans); font-size: .78rem; padding: .45rem .6rem;
         border: 1px solid var(--rule); border-radius: 3px; background: var(--ground); color: var(--ink); }
  .why:focus-visible { outline: 2px solid var(--steel); outline-offset: 1px; }

  .dock { position: fixed; left: 0; right: 0; bottom: 0; background: var(--panel);
          border-top: 1px solid var(--rule); padding: .7rem 1.25rem; display: flex; gap: 1rem;
          align-items: center; justify-content: center; flex-wrap: wrap; }
  .progress { font-family: var(--mono); font-size: .78rem; font-variant-numeric: tabular-nums; }
  .bar { width: 8rem; height: 4px; background: var(--rule); border-radius: 99px; overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 0; background: var(--steel); transition: width .2s ease; }
  @media (prefers-reduced-motion: reduce) { .bar > i { transition: none; } }
  .dock button { font-family: var(--mono); font-size: .78rem; padding: .45rem 1rem; border-radius: 3px;
                 border: 1px solid var(--steel); background: var(--steel); color: var(--panel); cursor: pointer; }
  .dock button[disabled] { opacity: .4; cursor: not-allowed; }
  .dock button.ghost { background: transparent; color: var(--steel); }
  .out { max-width: 60rem; margin: 0 auto 2rem; padding: 0 1.25rem; }
  .out pre { font-family: var(--mono); font-size: .68rem; background: var(--panel); border: 1px solid var(--rule);
             border-radius: 4px; padding: 1rem; overflow-x: auto; white-space: pre; }
  .out summary { font-family: var(--mono); font-size: .75rem; color: var(--steel); cursor: pointer; padding: .5rem 0; }
</style>

<div class="wrap">
  <header class="masthead">
    <div>
      <span class="kicker">panel re-judge &middot; ${esc(tag)}</span>
      <h1>${rows.length} claims cached as <em>${esc(want)}</em></h1>
      <p class="sub">Judge the <em>sentence</em> &mdash; is it true of those two cards? Not whether the synergy is
        interesting, and not whether the cached verdict was right. What was cached stays folded away until
        you ask for it, so it cannot anchor the answer.</p>
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

<script id="rows" type="application/json">${JSON.stringify(rows.map((r) => ({ producer: r.producer.name, consumer: r.consumer.name, tag: r.tag }))).replace(/</g, "\\u003c")}</script>
<script>
  (function () {
    var rows = JSON.parse(document.getElementById("rows").textContent);
    var verdicts = {};
    var notes = {};

    function line(i) {
      return JSON.stringify({
        producer: rows[i].producer, consumer: rows[i].consumer, tag: rows[i].tag,
        verdict: verdicts[i], cause: "",
        note: "USER VERDICT (cost-reduction re-judge, 2026-08-20). " + (notes[i] || "")
      });
    }
    function refresh() {
      var picked = Object.keys(verdicts);
      document.getElementById("done").textContent = String(picked.length);
      document.getElementById("fill").style.width = (picked.length / rows.length * 100) + "%";
      document.getElementById("copy").disabled = picked.length === 0;
      document.getElementById("json").textContent = picked.length
        ? picked.sort(function (a, b) { return a - b; }).map(function (i) { return line(i); }).join("\\n")
        : "judge a claim to start";
    }

    document.querySelectorAll(".claim").forEach(function (claim) {
      var i = claim.dataset.index;
      claim.querySelectorAll(".v").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var v = btn.dataset.v;
          if (verdicts[i] === v) { delete verdicts[i]; } else { verdicts[i] = v; }
          claim.querySelectorAll(".v").forEach(function (b) {
            b.setAttribute("aria-pressed", String(verdicts[i] === b.dataset.v));
          });
          claim.dataset.judged = verdicts[i] ? "1" : "0";
          var state = claim.querySelector(".state");
          state.dataset.state = verdicts[i] || "unjudged";
          state.textContent = verdicts[i] || "unjudged";
          refresh();
        });
      });
      claim.querySelector(".why").addEventListener("input", function (e) {
        notes[i] = e.target.value.trim();
        refresh();
      });
    });

    // CLIPBOARD ACCESS IS OFTEN DENIED IN A SANDBOXED FRAME, and the first version only reacted on
    // SUCCESS — so a rejected promise did nothing at all and the button looked broken. Three rungs:
    // the async API, then execCommand, then select the text so the reader can copy it themselves.
    // Every rung reports what happened; silence is the one outcome that is never acceptable.
    function flash(msg) {
      var b = document.getElementById("copy");
      b.textContent = msg;
      setTimeout(function () { b.textContent = "copy JSONL"; }, 1800);
    }
    function selectOutput() {
      var pre = document.getElementById("json");
      var open = pre.closest("details");
      if (open) { open.open = true; }
      var range = document.createRange();
      range.selectNodeContents(pre);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.getElementById("copy").addEventListener("click", function () {
      var text = document.getElementById("json").textContent;
      var done = function () { flash("copied"); };
      var fallback = function () {
        selectOutput();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        flash(ok ? "copied" : "selected \u2014 press Cmd/Ctrl+C");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });
    document.getElementById("reset").addEventListener("click", function () {
      verdicts = {}; notes = {};
      document.querySelectorAll(".claim").forEach(function (c) {
        c.dataset.judged = "0";
        c.querySelector(".state").dataset.state = "unjudged";
        c.querySelector(".state").textContent = "unjudged";
        c.querySelector(".why").value = "";
        c.querySelectorAll(".v").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      });
      refresh();
    });
    refresh();
  })();
</script>
`;
}
