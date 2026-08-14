/** FREE. Reports resource-ledger coverage and checks the spec's witnesses against the corpus.
 *
 *  Read-only: opens the corpus, counts, prints. Nothing here writes. */
import { MongoClient } from "mongodb";
import type { Ability } from "../schema.js";

const client = new MongoClient(process.env.MONGO_URL ?? "mongodb://localhost:27017");
await client.connect();
const db = client.db(process.env.MONGO_DB ?? "mtg");

const derived = await db.collection("cardTagsDerived").find({}).toArray();
console.log(`derived docs: ${derived.length}`);

let activated = 0, withCost = 0, total = 0, withAmount = 0, triggers = 0, withThreshold = 0;
for (const doc of derived) {
  for (const a of ((doc as Record<string, unknown>).abilities ?? []) as Ability[]) {
    total++;
    if (a.kind === "activated") { activated++; if (a.cost) withCost++; }
    if (a.amount !== undefined) withAmount++;
    if (a.trigger) { triggers++; if (a.trigger.threshold) withThreshold++; }
  }
}
console.log(`cost:      ${withCost} of ${activated} activated abilities non-empty`);
console.log(`amount:    ${withAmount} of ${total} abilities`);
console.log(`threshold: ${withThreshold} of ${triggers} triggers`);

// The spec's four witnesses. Join on cards._id === cardTagsDerived.oracleId -- the derived doc has
// NO name field, and joining on _id or name returns nothing while looking exactly like "this card
// has no derived tags".
const WITNESSES: [string, "threshold" | "none"][] = [
  ["The Millennium Calendar", "threshold"],
  ["Twenty-Toed Toad", "threshold"],
  ["Welcoming Vampire", "none"],
  ["Bolt Bend", "none"],
];
let failed = 0;
for (const [name, expected] of WITNESSES) {
  const card = await db.collection("cards").findOne({ name });
  if (!card) { console.log(`  ${name}: NOT IN CORPUS`); failed++; continue; }
  const doc = await db.collection("cardTagsDerived").findOne({ oracleId: card._id as unknown as string });
  const abilities = ((doc as Record<string, unknown> | null)?.abilities ?? []) as Ability[];
  const found = abilities.map((a) => a.trigger?.threshold?.atLeast).filter((n) => n !== undefined);
  const ok = expected === "threshold" ? found.length > 0 : found.length === 0;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: thresholds=${JSON.stringify(found)} (expected ${expected})`);
  if (!ok) failed++;
}
await client.close();
process.exit(failed > 0 ? 1 : 0);
