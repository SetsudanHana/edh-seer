/** THE ROWS THAT STILL NAME THE CARD'S BODY: why was the synthesised baseline the only supply that
 *  matched? Read-only, Mongo and the built artifact.
 *
 *  RAN 2026-09-04 over the 1,136 rows left after the mediation option, and it is what closed W1
 *  rather than leaving a residual nobody had looked at: **555 (48.9%) have a consumer that demands
 *  NONTOKEN**, so the card's token supply cannot satisfy it and the body is the only true half; the
 *  other 581 are the engine refusing the authored half on the merits. The implied body event is
 *  derived from the card's own printed characteristics, so where it is the only reason left it is
 *  true by construction. Not a defect family.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/w1-residual.ts */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { directedReasons } from "../edges.js";
import { loadHierarchy } from "../hierarchy.js";
import { demandForms, eventKey, supplyForms, type CardPageRecord } from "./partners-core.js";
import type { DeckCard } from "../types.js";

const outDir = "static-out";
const versionDir = readdirSync(outDir).find((d) => d.startsWith("v-"))!;
const store = await connect(loadConfig());
const cards = await store.cards.find({}).toArray();
const derivedRows = await store.db.collection<CardTags>(DERIVED_COLLECTION).find({}).toArray();
const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
const byName = new Map<string, DeckCard>();
for (const card of cards) if (!byName.has(card.name)) byName.set(card.name, { card, tags: tagsByOracle.get(card._id) ?? null } as never);
const h = loadHierarchy();

const cause: Record<string, number> = {};
const bump = (k: string) => { cause[k] = (cause[k] ?? 0) + 1; };
const samples: Record<string, string[]> = {};
const keep = (k: string, line: string) => { (samples[k] ??= []).length < 4 && samples[k]!.push(line); };

for (const f of readdirSync(join(outDir, versionDir, "partners"))) {
  const shard: Record<string, CardPageRecord> = JSON.parse(readFileSync(join(outDir, versionDir, "partners", f), "utf8"));
  for (const rec of Object.values(shard)) {
    const subject = byName.get(rec.name);
    if (!subject) continue;
    for (const row of rec.partners) {
      const partner = byName.get(row.name);
      if (!partner) continue;
      const reasons = directedReasons(subject, partner, h, { tokensMediate: false });
      const same = reasons.filter((r) => r.text === row.reason);
      if (same.length === 0 || !same.every((r) => r.impliedProducer === true)) continue;

      // Which authored emits could satisfy this row's demand at all?
      const accepted = new Set(demandForms(row.event));
      const authored = (subject.tags?.abilities ?? []).flatMap((a) => a.emits ?? [])
        .filter((e) => supplyForms(eventKey(e)).some((x) => accepted.has(x)));
      if (authored.length === 0) { bump("no authored supply for this demand -- the body is the only one"); keep("none", `${rec.name} -> ${row.name} [${row.event}]`); continue; }
      // Does the CONSUMER's matching trigger refuse a token outright?
      const refusesTokens = (partner.tags?.abilities ?? []).some((a) =>
        (a.trigger?.verbs ?? []).some((v) => demandForms(eventKey({ verb: v, subject: a.trigger!.subject } as never)).some((x) => accepted.has(x)))
        && a.trigger?.subject.token === false);
      const allTokens = authored.every((e) => e.subject?.token === true);
      if (allTokens && refusesTokens) { bump("authored supply is a TOKEN, consumer demands nontoken -- the body is the right half"); keep("nontoken", `${rec.name} -> ${row.name} [${row.event}] :: ${row.reason}`); continue; }
      if (allTokens) { bump("authored supply is a TOKEN and the engine still refused it"); keep("tokenrefused", `${rec.name} -> ${row.name} [${row.event}] :: ${row.reason}`); continue; }
      bump("authored NONTOKEN supply refused while the body matched"); keep("other", `${rec.name} -> ${row.name} [${row.event}] :: ${row.reason}`);
    }
  }
}
console.log(JSON.stringify(cause, null, 2));
for (const [k, v] of Object.entries(samples)) console.log(`\n[${k}]\n` + v.join("\n"));
await store.close?.();
