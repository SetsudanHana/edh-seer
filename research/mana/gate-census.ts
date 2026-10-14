/** GATE CENSUS (#1191, Fable round 2 finding 2): the instrument that measures a change to how `ManaLine.gate` is typed and read. Free, Mongo reads only.
 *  `npx tsx research/mana/gate-census.ts <out.json>`            (env sourced, sandbox off, repo root)
 *  `npx tsx research/mana/gate-census.ts --diff a.json b.json`  class counts before -> after, cards whose class or verdict moved, decks whose numbers moved.
 *
 *  WORKS UNCHANGED BEFORE AND AFTER `ManaLine.gate` becomes a typed union: the gate is read through `gateOf` alone (a string today, `{kind, ...}` later).
 *  CLASSES: control (gate.ts `boardGateOf` parses it), same-name, tron (goldfish.ts TRON_GATE shape), speed, initiative, unknown. After the typing, class = gate.kind.
 *
 *  1. CORPUS: every commander-legal card with a manaLine whose gate is non-null ($elemMatch: `{"manaLines.gate": {$ne: null}}` drops a doc that also has an ungated line).
 *  2. PER DECK, over the 268 decks the ramp census uses (calibration decks + precons). The fields a gate change moves:
 *     - colour audit: `deckMath.colors[].supplied` (cards able to make the colour: the number an unread gated source silently leaves out), `worst.available` (sources
 *       by the deadline, which reads `gateMetBy`), `worst.required`; `gold` (joint demand); `unreadSources` (derive could not read it, counted as no colour).
 *     - goldfish: `manaAvailability` (the report's simulated mana per turn: median / p25 / p75, and the share of the deck payable) and its `accelerants`; the
 *       closed-form `castability` mean (low/high over the 4 hardest rows the report carries, CASTABILITY_ROWS = 4, not over all priced cards: CEILING, a coarse signal) because a gate that turns met moves what a deck can cast.
 *     - land target: `lands.target`, `rawTarget`, `actual`, `accelerants`, `manaBase.colourMiss`, `manaBase.total`.
 *     - gated: each gated card in the deck, its class and `lineGateVerdict` (met / unmet / unknown). */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const R = "../../packages";

// THE ONE ADAPTER. Everything below reads a gate through these two functions. Since #1191 (DERIVE 310) `ManaLine.gate` is a typed `ManaGate` whose `kind` IS the class; a string gate
// (a stored row from before it) is only CLASSIFIED here, by a copy of the old grammars, so a pre-retype row still reads; `lineGateVerdict` takes the typed gate, so verdicts need a re-derived corpus.
type Line = { gate?: unknown; [k: string]: unknown };
const gm = await import(`${R}/matcher/src/gate.ts`);
export type GateClass = "control" | "same-name" | "tron" | "speed" | "initiative" | "unknown";
const KINDS: readonly GateClass[] = ["control", "same-name", "tron", "speed", "initiative", "unknown"];
function gateOf(gate: unknown): { text: string; cls: GateClass } {
  if (gate !== null && typeof gate === "object") {
    const g = gate as { kind?: string; text?: string };
    const cls = KINDS.find((k) => k === g.kind);
    if (cls === undefined) throw new Error(`gate-census: gate kind ${String(g.kind)} is not one of ${KINDS.join(", ")}`);
    return { text: g.text ?? JSON.stringify(gate), cls };
  }
  const text = String(gate).trim().toLowerCase();
  const TRON = /^you control (?:an?|the) (.{1,40}?) and (?:an?|the) (.{1,40})$/;
  let cls: GateClass = "unknown";
  if (text === "speed 4") cls = "speed";
  else if (text === "you have the initiative") cls = "initiative";
  else if (/^you control (?:(?:an?)|(?:\w+) or more) lands with the same name$/.test(text)) cls = "same-name";
  else if (/^you control (?:(?:an?)|(?:\w+) or more) [^ ]+(?: or (?:an? )?[^ ]+)*$/.test(text) && !/ and /.test(text)) cls = "control";
  else if (TRON.test(text)) cls = "tron";
  return { text, cls };
}
const verdictOf = (line: Line, dcs: unknown[]): string => gm.lineGateVerdict(line, dcs);

const round = (x: number | undefined | null, d = 4): number | null => (typeof x === "number" ? Math.round(x * 10 ** d) / 10 ** d : null);
const CLASSES: GateClass[] = ["control", "same-name", "tron", "speed", "initiative", "unknown"];

interface DeckRow {
  colours: Record<string, { supplied: number; available: number | null; required: number | null }>;
  gold: unknown; unreadSources: string[];
  goldfish: { accelerants: number | null; mana: Record<string, string>; payable: Record<string, number | null>; castableLow: number | null; castableHigh: number | null };
  lands: Record<string, number | null>;
  gated: Record<string, { cls: GateClass; gate: string; verdict: string }>;
}
interface Census { corpus: { counts: Record<string, number>; lines: number; cards: Record<string, { cls: GateClass; text: string }[]> }; decks: Record<string, DeckRow> }

async function measure(out: string): Promise<void> {
  const data = await import(`${R}/data/src/index.ts`);
  const docs = await import(`${R}/data/src/docs.ts`);
  const pre = await import(`${R}/data/src/precons.ts`);
  const tagger = await import(`${R}/tagger/src/index.ts`);
  const m = await import(`${R}/matcher/src/index.ts`);
  const ml = await import(`${R}/matcher/src/mana-lines.ts`);
  const eng = await import(`${R}/engine/src/index.ts`);
  const { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS } = data;
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const tags = tagger.createTagsLookup(store.db, "derived");

  const census: Census = { corpus: { counts: Object.fromEntries(CLASSES.map((c) => [c, 0])), lines: 0, cards: {} }, decks: {} };
  const gatedDocs = await store.db.collection("cardTagsDerived").find({ manaLines: { $elemMatch: { gate: { $ne: null } } } }).toArray();
  const legal = new Map<string, string>();
  for await (const c of store.db.collection("cards").find({ _id: { $in: gatedDocs.map((d: any) => d.oracleId) }, "legalities.commander": "legal" })) legal.set(String(c._id), docs.docToCard(c).name);
  for (const d of gatedDocs as any[]) {
    const name = legal.get(String(d.oracleId));
    if (name === undefined) continue;
    for (const l of d.manaLines as Line[]) {
      if (l.gate === null || l.gate === undefined) continue;
      const g = gateOf(l.gate);
      census.corpus.counts[g.cls] = (census.corpus.counts[g.cls] ?? 0) + 1; census.corpus.lines += 1;
      (census.corpus.cards[name] ??= []).push(g);
    }
  }

  const jobs: { name: string; text: string }[] = [
    ...readdirSync(CALIBRATION_DECKS).filter((f: string) => f.endsWith(".txt")).sort().map((f: string) => ({ name: "cal:" + f.replace(/\.txt$/, ""), text: readFileSync(`${CALIBRATION_DECKS}/${f}`, "utf8") })),
    ...(JSON.parse(readFileSync("packages/data/precons.json", "utf8")) as any[]).map((p) => ({ name: `pre:${p.setCode}:${p.name}`, text: pre.preconDecklist(p) })),
  ];
  for (const j of jobs) {
    const s = parseDecklistSections(j.text);
    const { cards, combos } = await resolveNames([...s.commanders, ...s.deck], lookup);
    const cmdNames = new Set(s.commanders.map(normalizeName));
    const dcs = await m.buildDeckCards(cards, lookup, tags);
    const cn = dcs.filter((dc: any) => cmdNames.has(normalizeName(dc.card.name))).map((dc: any) => dc.card.name);
    const rep: any = m.analyzeDeckStructured(dcs, cn, undefined, undefined, new eng.ComboIndex(combos));
    const dm = rep.deckMath ?? {};
    const colours: DeckRow["colours"] = {};
    for (const c of dm.colors ?? []) colours[c.color] = { supplied: c.supplied, available: c.worst?.available ?? null, required: c.worst?.required ?? null };
    const mana: Record<string, string> = {}, payable: Record<string, number | null> = {};
    for (const r of rep.manaAvailability?.rows ?? []) { mana[r.turn] = `${r.mana.p25}/${r.mana.median}/${r.mana.p75}`; payable[r.turn] = round(r.payableShare?.median, 3); }
    const cs = (dm.castability?.cards ?? []) as { castable: { low: number; high: number } }[];
    const mean = (k: "low" | "high"): number | null => (cs.length ? round(cs.reduce((a, c) => a + c.castable[k], 0) / cs.length) : null);
    const L = dm.lands ?? {};
    const gated: DeckRow["gated"] = {};
    for (const dc of dcs as any[]) for (const l of ml.cardLines(dc, true) as Line[]) {
      if (l.gate === null || l.gate === undefined) continue;
      const g = gateOf(l.gate);
      gated[`${dc.card.name} | ${g.text}`] = { cls: g.cls, gate: g.text, verdict: verdictOf(l, dcs) };
    }
    census.decks[j.name] = {
      colours, gold: dm.gold ?? null, unreadSources: dm.unreadSources ?? [],
      goldfish: { accelerants: rep.manaAvailability?.accelerants ?? null, mana, payable, castableLow: mean("low"), castableHigh: mean("high") },
      lands: { target: L.target ?? null, rawTarget: L.rawTarget ?? null, actual: L.actual ?? null, accelerants: L.accelerants ?? null, colourMiss: round(L.manaBase?.colourMiss), manaBaseTotal: round(L.manaBase?.total) },
      gated,
    };
  }
  writeFileSync(out, JSON.stringify(census, null, 1));
  const withGated = Object.values(census.decks).filter((d) => Object.keys(d.gated).length > 0).length;
  console.log(`gated lines ${census.corpus.lines} in ${Object.keys(census.corpus.cards).length} commander-legal cards:`, JSON.stringify(census.corpus.counts));
  console.log(`decks ${Object.keys(census.decks).length}, containing a gated card ${withGated}`);
  const v: Record<string, number> = {};
  for (const d of Object.values(census.decks)) for (const g of Object.values(d.gated)) v[g.verdict] = (v[g.verdict] ?? 0) + 1;
  console.log("deck-card verdicts:", JSON.stringify(v));
  await store.close();
}

function diff(a: Census, b: Census): void {
  console.log("CLASS COUNTS (before -> after)");
  for (const c of new Set([...Object.keys(a.corpus.counts), ...Object.keys(b.corpus.counts)])) console.log(`  ${c}: ${a.corpus.counts[c] ?? 0} -> ${b.corpus.counts[c] ?? 0}`);
  console.log(`  total lines: ${a.corpus.lines} -> ${b.corpus.lines}`);
  console.log("CARDS WHOSE CLASS MOVED");
  const clsKey = (x: { cls: string }[] | undefined): string => (x ?? []).map((g) => g.cls).sort().join(",") || "(none)";
  for (const n of [...new Set([...Object.keys(a.corpus.cards), ...Object.keys(b.corpus.cards)])].sort()) if (clsKey(a.corpus.cards[n]) !== clsKey(b.corpus.cards[n])) console.log(`  ${n}: ${clsKey(a.corpus.cards[n])} -> ${clsKey(b.corpus.cards[n])}`);
  console.log("CARD VERDICT / CLASS CHANGES PER DECK (card | gate keyed by gate text; a retyped gate changes its text, so match by card name)");
  const byCard = (d: DeckRow): Map<string, string> => {
    const lines = new Map<string, string[]>();
    for (const [k, g] of Object.entries(d.gated)) { const n = k.split(" | ")[0]!; lines.set(n, [...(lines.get(n) ?? []), `${g.cls}:${g.verdict}`]); }
    return new Map([...lines].map(([n, v]) => [n, v.sort().join(" + ")] as const));
  };
  const moved = new Map<string, Set<string>>();
  for (const [dn, da] of Object.entries(a.decks)) {
    const db = b.decks[dn]; if (!db) continue;
    const ca = byCard(da), cb = byCard(db);
    for (const n of new Set([...ca.keys(), ...cb.keys()])) {
      if (ca.get(n) === cb.get(n)) continue;
      const key = `${n}: ${ca.get(n) ?? "-"} -> ${cb.get(n) ?? "-"}`;
      const set = moved.get(key) ?? new Set<string>();
      moved.set(key, set.add(dn));
    }
  }
  for (const [k, ds] of [...moved].sort()) console.log(`  ${k}  (${ds.size} decks)`);
  console.log("DECKS WHOSE NUMBERS MOVED");
  let nm = 0;
  const flat = (d: DeckRow): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [c, v] of Object.entries(d.colours)) { o[`colour ${c} supplied`] = v.supplied; o[`colour ${c} available`] = v.available; o[`colour ${c} required`] = v.required; }
    o.gold = JSON.stringify(d.gold); o.unreadSources = d.unreadSources.length;
    o.accelerants = d.goldfish.accelerants; o.castableLow = d.goldfish.castableLow; o.castableHigh = d.goldfish.castableHigh;
    for (const [t, v] of Object.entries(d.goldfish.mana)) o[`mana t${t} p25/med/p75`] = v;
    for (const [t, v] of Object.entries(d.goldfish.payable)) o[`payable t${t}`] = v;
    for (const [k, v] of Object.entries(d.lands)) o[`lands ${k}`] = v;
    return o;
  };
  for (const [dn, da] of Object.entries(a.decks)) {
    const db = b.decks[dn]; if (!db) { console.log(`  ${dn}: missing after`); continue; }
    const fa = flat(da), fb = flat(db);
    const ch = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k])).map((k) => `${k} ${JSON.stringify(fa[k])} -> ${JSON.stringify(fb[k])}`);
    if (ch.length) { nm++; console.log(`  ${dn}: ${ch.join("; ")}`); }
  }
  console.log(`  ${nm} of ${Object.keys(a.decks).length} decks moved`);
}

const args = process.argv.slice(2);
if (args[0] === "--diff") {
  if (args.length !== 3) throw new Error("usage: gate-census.ts --diff a.json b.json");
  diff(JSON.parse(readFileSync(args[1]!, "utf8")), JSON.parse(readFileSync(args[2]!, "utf8")));
} else if (args[0]) await measure(args[0]);
else throw new Error("usage: gate-census.ts <out.json> | --diff a.json b.json");
