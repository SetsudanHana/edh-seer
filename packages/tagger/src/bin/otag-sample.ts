import { readFileSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";

/**
 * Print sample cards for otag slugs, so classifications are checked against real cards.
 *
 * Usage:
 *   otag-sample --group drain        one JSON group from functional-otags.json
 *   otag-sample --slug drain-life    a single slug
 *   otag-sample --group drain --n 8  sample size (default 5)
 */
async function main(): Promise<void> {
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const groupName = arg("--group");
  const slugArg = arg("--slug");
  const n = Number(arg("--n") ?? 5);
  if (!groupName && !slugArg) {
    console.error("usage: otag-sample (--group <name> | --slug <slug>) [--n 5]");
    process.exit(1);
  }

  const groups = JSON.parse(
    readFileSync(new URL("../otags/functional-otags.json", import.meta.url), "utf8"),
  ) as Record<string, string[]>;

  let slugs: string[];
  if (slugArg) {
    slugs = [slugArg];
  } else {
    const g = groups[groupName as string];
    if (!g) {
      console.error(`unknown group "${groupName}". Groups: ${Object.keys(groups).join(", ")}`);
      process.exit(1);
    }
    slugs = g;
  }

  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const otags = store.db.collection("cardOtags");

  for (const slug of slugs) {
    const docs = (await otags
      .find({ otags: slug }, { projection: { _id: 1 } })
      .limit(n * 4)
      .toArray()) as unknown as Array<{ _id: string }>;
    const total = await otags.countDocuments({ otags: slug });
    console.log(`\n=== ${slug} (${total} cards) ===`);
    if (!docs.length) {
      console.log("  (no cards -- slug may be unfetched or empty)");
      continue;
    }
    const ids = docs.slice(0, n).map((d) => d._id);
    const sample = (await cards
      .find({ _id: { $in: ids } } as never, { projection: { name: 1, typeLine: 1, oracleText: 1 } })
      .toArray()) as unknown as Array<{ name: string; typeLine: string; oracleText: string }>;
    for (const c of sample) {
      console.log(`  ${c.name} [${c.typeLine}]`);
      console.log(`    ${(c.oracleText || "").replace(/\n/g, " / ").slice(0, 160)}`);
    }
  }
  await store.close();
}

main().catch((err) => {
  console.error("otag-sample failed:", err);
  process.exit(1);
});
