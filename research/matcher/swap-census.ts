/** THE SWAP CENSUS (docs/plans/2026-10-04-same-job-review.md, "How this was measured"): every swap the
 *  precon pages offer, by kind, from a deployed site or a local static build.
 *
 *    npx tsx research/matcher/swap-census.ts https://edhseer.cards/static      # what is live
 *    npx tsx research/matcher/swap-census.ts static-out                         # a local build
 *
 *  Prints the swap count by kind, the distinct role swaps (out -> in), and how many role swaps say
 *  only a mana difference ("for N less mana"). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2] ?? "static-out";
const remote = /^https?:\/\//.test(src);
const get = async (path: string): Promise<unknown> => remote
  ? (await fetch(`${src.replace(/\/$/, "")}/${path}`)).json()
  : JSON.parse(readFileSync(join(src, path), "utf8"));
const { version, precons } = await get("manifest.json") as { version: string; precons?: string };
if (!precons) { console.error("manifest.json has no `precons` pointer: no precon pages."); process.exit(1); }
const dir = `${version}/precons/${precons}`;
const slugs: string[] = remote
  ? ((await get(`${dir}/index.json`)) as { slug: string }[]).map((p) => p.slug)
  : readdirSync(join(src, dir)).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.slice(0, -5));
type Swap = { kind: string; out: { name: string; reason: string }; in: { name: string; reason: string } };
const byKind = new Map<string, number>();
const roleSwaps = new Map<string, number>();
let manaOnly = 0, role = 0, pages = 0;
for (const slug of slugs) {
  const path = `${dir}/${slug}.json`;
  if (!remote && !existsSync(join(src, path))) continue;
  const page = await get(path) as { packages?: { sections: { swaps: Swap[] }[]; bringDown?: Swap[] }[] };
  if (!page.packages) continue;
  pages++;
  const seen = new Set<string>();
  for (const pkg of page.packages) for (const s of [...pkg.sections.flatMap((x) => x.swaps), ...(pkg.bringDown ?? [])]) {
    const id = `${s.kind}|${s.out.name}|${s.in.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    if (s.kind === "role") {
      role++;
      roleSwaps.set(`${s.out.name} -> ${s.in.name}`, (roleSwaps.get(`${s.out.name} -> ${s.in.name}`) ?? 0) + 1);
      if (/less mana/i.test(s.in.reason) && !/,|;| and /.test(s.in.reason.replace(/for \d+ less mana/i, ""))) manaOnly++;
    }
  }
}
console.log(`${src} ${version}: ${pages} precon pages`);
console.log(`swaps by kind: ${[...byKind].sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`role swaps ${role} (${roleSwaps.size} distinct), ${manaOnly} justified by mana alone (${role ? Math.round((100 * manaOnly) / role) : 0}%)`);
for (const [p, n] of [...roleSwaps].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(3)} ${p}`);
