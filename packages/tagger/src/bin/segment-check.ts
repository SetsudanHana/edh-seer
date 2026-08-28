/** Runs the mechanical segmenter over the whole corpus and reports where it looks wrong.
 *  Free — no LLM. Catches segmentation bugs before any tagging spend. */
import { connect, loadConfig } from "@edh-seer/data";
import { segment } from "../segment.js";

const s = await connect(loadConfig());
let cards = 0, zero = 0, big = 0;
const kinds = new Map<string, number>();
const zeroEx: string[] = [], bigEx: string[] = [];
for await (const d of s.db.collection("cards").find({}, { projection: { name: 1, oracleText: 1, keywords: 1 } })) {
  const c = d as unknown as { name: string; oracleText?: string; keywords?: string[] };
  const text = (c.oracleText ?? "").trim();
  if (text === "") continue;             // genuinely vanilla; nothing to segment
  cards++;
  const cl = segment(text, c.keywords ?? []);
  for (const x of cl) kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
  if (cl.length === 0) { zero++; if (zeroEx.length < 8) zeroEx.push(`${c.name}: ${text.slice(0, 60)}`); }
  if (cl.length > 12) { big++; if (bigEx.length < 5) bigEx.push(`${c.name} (${cl.length})`); }
}
console.log(`cards with oracle text: ${cards}`);
console.log(`  segmented to ZERO clauses : ${zero}   <- must be 0; a card with text always has a clause`);
for (const e of zeroEx) console.log(`      ${e}`);
console.log(`  more than 12 clauses      : ${big}   ${bigEx.join(", ")}`);
console.log(`\nclause kinds: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ")}`);
await s.close();
