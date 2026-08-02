import { connect, loadConfig } from "@mtg/data";
import type { CardTags } from "../schema.js";
import { OTAG_EVENT_TO_VERB, loadOtagSemantics } from "../otags/semantics.js";

/**
 * Cross-check otag semantics against the LLM-tagged corpus, and list slugs whose meaning
 * has no EffectKind target.
 *
 * Agreement is a SIGNAL, not ground truth: otags are believed more accurate than the LLM in
 * places (the forced-sacrifice mislabel), so disagreement flags a slug for review rather
 * than failing it.
 */
async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const sem = loadOtagSemantics();

  const tagsById = new Map<string, CardTags>();
  for (const t of (await store.db.collection("cardTags").find({}).toArray()) as unknown as CardTags[]) {
    tagsById.set(t.oracleId, t);
  }
  const otagDocs = (await store.db
    .collection("cardOtags")
    .find({}, { projection: { _id: 1, otags: 1 } })
    .toArray()) as unknown as Array<{ _id: string; otags: string[] }>;

  const bySlug = new Map<string, string[]>();
  for (const d of otagDocs) {
    for (const s of d.otags ?? []) {
      let ids = bySlug.get(s);
      if (!ids) { ids = []; bySlug.set(s, ids); }
      ids.push(d._id);
    }
  }

  const rows: Array<{ slug: string; check: string; n: number; agree: number }> = [];
  for (const [slug, s] of sem) {
    const ids = (bySlug.get(slug) ?? []).filter((id) => tagsById.has(id));
    if (ids.length < 5) continue; // too few LLM-tagged cards to say anything

    if (s.effectKind) {
      const agree = ids.filter((id) =>
        tagsById.get(id)!.abilities.some((a) => a.effect.kind === s.effectKind),
      ).length;
      rows.push({ slug, check: `effectKind=${s.effectKind}`, n: ids.length, agree });
    }
    for (const ev of s.events) {
      const verb = OTAG_EVENT_TO_VERB[ev.event];
      if (!verb) continue; // no engine equivalent, nothing to compare against
      const agree = ids.filter((id) => {
        const t = tagsById.get(id)!;
        return ev.role === "consumer"
          ? t.abilities.some((a) => a.trigger?.verbs.includes(verb))
          : t.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === verb));
      }).length;
      rows.push({ slug, check: `${ev.role}:${ev.event}`, n: ids.length, agree });
    }
  }

  rows.sort((a, b) => a.agree / a.n - b.agree / b.n);
  console.log("=== otag semantics cross-check (lowest agreement first) ===");
  console.log("agreement is a signal for review, not a pass/fail\n");
  for (const r of rows) {
    const pct = ((100 * r.agree) / r.n).toFixed(0);
    console.log(`  ${String(pct).padStart(3)}%  ${r.slug.padEnd(30)} ${r.check.padEnd(28)} (${r.agree}/${r.n})`);
  }

  const gap = [...sem.entries()].filter(([, s]) => s.needsEffectKind !== undefined);
  const byKind = new Map<string, string[]>();
  for (const [slug, s] of gap) {
    const k = s.needsEffectKind as string;
    let list = byKind.get(k);
    if (!list) { list = []; byKind.set(k, list); }
    list.push(slug);
  }
  console.log(`\n=== slugs needing a new EffectKind (${gap.length}) ===`);
  console.log("input to the forced-sacrifice reclassify, which adds these kinds to EFFECT_KINDS\n");
  for (const [kind, slugs] of byKind) console.log(`  ${kind}: ${slugs.join(", ")}`);

  await store.close();
}

main().catch((err) => {
  console.error("verify-otag-semantics failed:", err);
  process.exit(1);
});
