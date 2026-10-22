// LOCAL RESEARCH ONLY (#1318): the (producer card, consumer card) pairs that match on ONE event verb, to diff before/after a derive change. FREE: reads Mongo (cardTagsDerived), writes only the file named.
// Panel and deck reasons read 0 on a new false edge, so an emit change needs this diff (memory: emit-change-needs-event-match-diff).
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`:
//   npx tsx research/matcher/event-match-diff.ts dump <verb> <out.json>      -- write the pair set
//   npx tsx research/matcher/event-match-diff.ts diff <old.json> <new.json>   -- new / lost pairs, producers whose events moved
import { readFileSync, writeFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { eventMatches, producerEvents } from "../../packages/matcher/src/edges.js";
import { loadHierarchy } from "../../packages/matcher/src/hierarchy.js";
import { normalizeZoneEvent } from "../../packages/matcher/src/zones.js";

const [mode, a, b] = process.argv.slice(2);
if (mode === "diff") {
  const o = JSON.parse(readFileSync(a!, "utf8")) as { pairs: string[]; producers: string[]; consumers: string[] };
  const n = JSON.parse(readFileSync(b!, "utf8")) as typeof o;
  const os = new Set(o.pairs), ns = new Set(n.pairs);
  const added = n.pairs.filter((p) => !os.has(p)), lost = o.pairs.filter((p) => !ns.has(p));
  console.log(`pairs ${o.pairs.length} -> ${n.pairs.length}: new ${added.length}, lost ${lost.length}`);
  console.log(`producer cards ${o.producers.length} -> ${n.producers.length}; consumer cards ${o.consumers.length} -> ${n.consumers.length}`);
  for (const p of added) console.log("NEW  ", p);
  for (const p of lost) console.log("LOST ", p);
} else if (mode === "dump") {
  const verb = a!;
  const h = loadHierarchy();
  const store = await connect(loadConfig());
  const prods: { name: string; events: ReturnType<typeof producerEvents> }[] = [];
  const cons: { name: string; events: ReturnType<typeof normalizeZoneEvent>[] }[] = [];
  for await (const doc of store.db.collection("cardTagsDerived").find({ isToken: { $ne: true } }) as AsyncIterable<CardTags & { name: string }>) {
    const name = doc.name ?? doc.oracleId;
    const pe = producerEvents(doc).filter((e) => e.verb === verb);
    if (pe.length) prods.push({ name, events: pe });
    const ce = (doc.abilities ?? []).flatMap((ab) => ab.trigger?.verbs.includes(verb as never) ? [normalizeZoneEvent({ verb: verb as never, subject: ab.trigger.subject })] : []);
    if (ce.length) cons.push({ name, events: ce });
  }
  const pairs = new Set<string>();
  for (const p of prods) for (const c of cons) if (p.events.some((pe) => c.events.some((ce) => eventMatches(pe, ce, h)))) pairs.add(`${p.name} >> ${c.name}`);
  writeFileSync(b!, JSON.stringify({ pairs: [...pairs].sort(), producers: prods.map((p) => p.name).sort(), consumers: cons.map((c) => c.name).sort() }));
  console.log(`${verb}: ${prods.length} producer cards x ${cons.length} consumer cards, ${pairs.size} matching pairs -> ${b}`);
  await store.close();
} else console.log("usage: dump <verb> <out.json> | diff <old.json> <new.json>");
