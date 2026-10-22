// LOCAL RESEARCH ONLY (#1302): oracleId -> name, clauseSource of every derived row, to diff which cards switched between the printed-text grammar and the stored model answer across a derive change. FREE, read-only.
import { writeFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
const store = await connect(loadConfig());
const out: Record<string, string> = {};
for await (const r of store.db.collection<any>("cardTagsDerived").find({}, { projection: { oracleId: 1, name: 1, clauseSource: 1 } })) out[`${r.oracleId}|${r.name}`] = r.clauseSource ?? "model";
writeFileSync(process.argv[2]!, JSON.stringify(out));
console.log(Object.keys(out).length, "rows,", Object.values(out).filter((v) => v === "grammar").length, "grammar");
await store.close();
