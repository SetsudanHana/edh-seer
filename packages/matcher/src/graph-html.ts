import type { CardGraph, NodeKind } from "./graph.js";

/** Node-kind palette. Hub kinds (layout, cmc, mana, colour identity) are deliberately dull, since
 *  they connect nearly every card and carry almost no information -- the same reason the engine
 *  IDF-weights common events. The kinds worth looking at are loud. */
const PALETTE: Record<NodeKind, string> = {
  card: "#e8e8ea",
  face: "#8b8b93",
  event: "#ff4d6d",
  subtype: "#ff8a3d",
  keyword: "#4ec9b0",
  token: "#ffd23f",
  related: "#c586c0",
  type: "#5aa9e6",
  supertype: "#9d7bff",
  color: "#6b6b73",
  mana: "#5a5a61",
  cmc: "#4a4a51",
  layout: "#3d3d43",
  power: "#e05263",
  toughness: "#b8455c",
};

/** Kinds hidden on first paint: each connects nearly every card in a typical subgraph, so leaving
 *  them on makes the first thing anyone sees a starburst around `layout:normal`. Toggleable. */
const DIM_BY_DEFAULT: NodeKind[] = ["layout", "cmc", "mana", "color"];

/** Render a graph as a single self-contained HTML file: no CDN, no build step, no install. Open it
 *  in a browser and it lays itself out.
 *
 *  THIS IS NOT THE APP'S DECK BOARD, AND IT IS NOT MEANT TO BE (roadmap H13, refused 2026-08-22).
 *  The two render DIFFERENT GRAPHS. This one is `buildGraph`'s printed-characteristics graph — cards
 *  joined through their type, subtype, keyword, mana, cmc and layout nodes, plus reified `event:`
 *  nodes under `--events` — around 330 nodes for one deck, aimed at Cytoscape/Gephi-style
 *  exploration of what cards SHARE. The app's board (`projectDeckGraph` + `board-force.ts`) draws
 *  ~84 nodes: the cards themselves and the synergy edges between them.
 *
 *  So the physics differing is not a divergence between two views of one thing. This loop is
 *  inverse-SQUARE repulsion (`900/d²`, rest 70, damping 0.86, gravity 0.0016) against d3's
 *  inverse-LINEAR `forceManyBody`, and unifying them was considered and refused: there is nothing to
 *  match, `d3-force` is a dependency of `@mtg/web` rather than this package, and the kind checkboxes
 *  below deliberately RE-SETTLE the layout (`alpha = 0.5`), so a pre-settled static export would be
 *  a behaviour change rather than a simplification.
 *
 *  ponytail: O(n^2) repulsion every tick, which is fine for the few-hundred-node subgraphs the
 *  exporter produces (a deck is ~330 nodes = ~54k pairs) and would need Barnes-Hut past a few
 *  thousand. The exporter caps card count anyway, so that ceiling is not reachable today. */
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function toHtml(g: CardGraph, rawTitle: string): string {
  const title = escapeHtml(rawTitle);
  /** `<` is escaped to its JSON unicode form so a card name containing `</script>` cannot close the
   *  inline script tag it is embedded in. No real card name does, but the payload is corpus data and
   *  the escape costs nothing. */
  const data = JSON.stringify({
    nodes: g.nodes.map((n) => ({ id: n.id, k: n.kind, l: n.label })),
    edges: g.edges.map((e) => ({ s: e.from, t: e.to, k: e.kind })),
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#141416; color:#e8e8ea; font:13px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif; overflow:hidden; }
  canvas { display:block; cursor:grab; }
  canvas.drag { cursor:grabbing; }
  #panel { position:fixed; top:12px; left:12px; background:#1e1e21ee; border:1px solid #33333a; border-radius:10px;
           padding:12px 14px; max-height:calc(100vh - 24px); overflow:auto; backdrop-filter:blur(8px); min-width:190px; }
  h1 { font-size:13px; margin:0 0 2px; font-weight:600; }
  .sub { color:#8b8b93; font-size:11px; margin-bottom:10px; }
  label { display:flex; align-items:center; gap:7px; padding:2px 0; cursor:pointer; user-select:none; }
  label:hover { color:#fff; }
  .dot { width:9px; height:9px; border-radius:50%; flex:none; }
  .n { margin-left:auto; color:#6b6b73; font-variant-numeric:tabular-nums; font-size:11px; }
  input { accent-color:#ff8a3d; margin:0; }
  #hint { position:fixed; bottom:12px; left:12px; color:#6b6b73; font-size:11px; }
  #tip { position:fixed; padding:4px 8px; background:#000d; border:1px solid #44444c; border-radius:6px;
         pointer-events:none; font-size:12px; display:none; white-space:nowrap; }
</style>
<canvas id="c"></canvas>
<div id="panel"><h1>${title}</h1><div class="sub" id="counts"></div><div id="kinds"></div></div>
<div id="hint">drag to pan &middot; scroll to zoom &middot; hover a node for its label</div>
<div id="tip"></div>
<script>
const G = ${data};
const PALETTE = ${JSON.stringify(PALETTE)};
const hidden = new Set(${JSON.stringify(DIM_BY_DEFAULT)});

const cv = document.getElementById("c"), ctx = cv.getContext("2d");
let W, H;
const resize = () => { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio;
  cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; };
resize(); addEventListener("resize", resize);

// Layout state. Seeded on a circle so the first frames expand outward instead of exploding.
const N = G.nodes.map((n, i) => ({ ...n, x: Math.cos(i) * 300 + Math.random() * 40,
  y: Math.sin(i) * 300 + Math.random() * 40, vx: 0, vy: 0, deg: 0 }));
const byId = new Map(N.map((n) => [n.id, n]));
const E = G.edges.map((e) => ({ s: byId.get(e.s), t: byId.get(e.t), k: e.k })).filter((e) => e.s && e.t);
for (const e of E) { e.s.deg++; e.t.deg++; }

const counts = {};
for (const n of N) counts[n.k] = (counts[n.k] || 0) + 1;
document.getElementById("counts").textContent = N.length + " nodes, " + E.length + " edges";

const kinds = document.getElementById("kinds");
for (const k of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) {
  // Built with DOM calls rather than innerHTML: the values are our own closed NodeKind set, but a
  // string-built label is the kind of thing that quietly becomes an injection point later.
  const lab = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox"; box.checked = !hidden.has(k);
  box.onchange = () => { box.checked ? hidden.delete(k) : hidden.add(k); alpha = 0.5; };
  const dot = document.createElement("span");
  dot.className = "dot"; dot.style.background = PALETTE[k] || "#888";
  const num = document.createElement("span");
  num.className = "n"; num.textContent = String(counts[k]);
  lab.append(box, dot, document.createTextNode(k), num);
  kinds.appendChild(lab);
}

const vis = (n) => !hidden.has(n.k);
let alpha = 1, cam = { x: 0, y: 0, z: 1 };

function tick() {
  const live = N.filter(vis);
  // Repulsion, every visible pair. See the ponytail note in graph-html.ts on the O(n^2) ceiling.
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1;
    if (d2 > 250000) continue;
    const f = 900 / d2, d = Math.sqrt(d2);
    dx = dx / d * f; dy = dy / d * f;
    a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
  }
  // Springs, shorter for high-degree hubs so they sit at the centre of their own cluster.
  for (const e of E) {
    if (!vis(e.s) || !vis(e.t)) continue;
    const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.hypot(dx, dy) || 1;
    const rest = 70, f = (d - rest) * 0.008;
    e.s.vx += dx / d * f; e.s.vy += dy / d * f; e.t.vx -= dx / d * f; e.t.vy -= dy / d * f;
  }
  for (const n of live) {
    n.vx -= n.x * 0.0016; n.vy -= n.y * 0.0016;           // gravity toward origin
    n.vx *= 0.86; n.vy *= 0.86;                            // damping
    n.x += n.vx * alpha; n.y += n.vy * alpha;
  }
  alpha = Math.max(alpha * 0.995, 0.02);
}

const rad = (n) => n.k === "card" ? 4 : Math.min(3 + Math.sqrt(n.deg) * 1.6, 16);

function draw() {
  const dpr = devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#141416"; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(cam.z * dpr, 0, 0, cam.z * dpr, W / 2 + cam.x * dpr, H / 2 + cam.y * dpr);

  ctx.lineWidth = 0.6 / cam.z;
  ctx.strokeStyle = "#ffffff14";
  ctx.beginPath();
  for (const e of E) {
    if (!vis(e.s) || !vis(e.t)) continue;
    ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y);
  }
  ctx.stroke();

  for (const n of N) {
    if (!vis(n)) continue;
    ctx.fillStyle = PALETTE[n.k] || "#888";
    ctx.beginPath(); ctx.arc(n.x, n.y, rad(n), 0, 7); ctx.fill();
  }
  // Label the hubs only -- labelling every node is illegible and labelling none is useless.
  ctx.fillStyle = "#e8e8ea"; ctx.font = (11 / cam.z) + "px ui-sans-serif,system-ui,sans-serif";
  for (const n of N) if (vis(n) && n.k !== "card" && n.k !== "face" && n.deg >= 6) ctx.fillText(n.l, n.x + rad(n) + 3, n.y + 3);
}

(function loop() { tick(); draw(); requestAnimationFrame(loop); })();

// --- interaction ---
let drag = null;
cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY }; cv.classList.add("drag"); cv.setPointerCapture(e.pointerId); };
cv.onpointerup = () => { drag = null; cv.classList.remove("drag"); };
cv.onwheel = (e) => { e.preventDefault(); cam.z = Math.min(6, Math.max(0.1, cam.z * (e.deltaY < 0 ? 1.1 : 0.9))); };
const tip = document.getElementById("tip");
cv.onpointermove = (e) => {
  if (drag) { cam.x += e.clientX - drag.x; cam.y += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; return; }
  const wx = (e.clientX - innerWidth / 2 - cam.x) / cam.z, wy = (e.clientY - innerHeight / 2 - cam.y) / cam.z;
  let best = null, bd = 12 / cam.z;
  for (const n of N) { if (!vis(n)) continue; const d = Math.hypot(n.x - wx, n.y - wy); if (d < bd) { bd = d; best = n; } }
  if (best) { tip.style.display = "block"; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY + 12 + "px";
              tip.textContent = best.l + "  (" + best.k + ", " + best.deg + " links)"; }
  else tip.style.display = "none";
};
</script>`;
}
