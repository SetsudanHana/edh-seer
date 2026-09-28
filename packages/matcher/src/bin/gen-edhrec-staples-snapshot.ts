/** A ONE-TIME SNAPSHOT OF EDHREC's MOST-PLAYED CARDS PER COLOUR IDENTITY (owner, 2026-09-27: "edhrec
 *  has pages with staples for each color identity" -- "I would still use their information as one of
 *  callibration"). The casual-play counterpart to `staples-edhtop16.json`, which is competitive play
 *  and made the per-role quality rank lead with Simian Spirit Guide and Pyroblast. Used to CALIBRATE
 *  our own ranking, never shown as EDHREC's list. Writes `packages/matcher/staples-edhrec.json`.
 *  Run deliberately to take a new snapshot -- never from a build.
 *
 *    tsx src/bin/gen-edhrec-staples-snapshot.ts
 *
 *  One request per colour identity to EDHREC's public JSON (`json.edhrec.com/pages/top/<name>.json`),
 *  a second apart. An identity whose page does not answer is reported and left out, not guessed. */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "staples-edhrec.json");
const UA = "edh-seer (https://edhseer.cards)";

/** EDHREC's page name for each colour identity, WUBRG letters -> slug. */
export const IDENTITY_PAGES: Record<string, string> = {
  C: "colorless", W: "white", U: "blue", B: "black", R: "red", G: "green",
  WU: "azorius", UB: "dimir", BR: "rakdos", RG: "gruul", WG: "selesnya",
  WB: "orzhov", UR: "izzet", BG: "golgari", WR: "boros", UG: "simic",
  WUB: "esper", UBR: "grixis", BRG: "jund", WRG: "naya", WUG: "bant",
  WBG: "abzan", WUR: "jeskai", UBG: "sultai", WBR: "mardu", URG: "temur",
  UBRG: "glint-eye", WBRG: "dune-brood", WURG: "ink-treader", WUBG: "witch-maw", WUBR: "yore-tiller",
  WUBRG: "five-color",
};

interface CardView { name: string; num_decks?: number; potential_decks?: number }
interface Page { container?: { json_dict?: { cardlists?: { header: string; cardviews: CardView[] }[] } } }

async function page(slug: string): Promise<Page | null> {
  const res = await fetch(`https://json.edhrec.com/pages/top/${slug}.json`, { headers: { "User-Agent": UA } });
  return res.ok ? await res.json() as Page : null;
}

async function main(): Promise<void> {
  const identities: Record<string, { name: string; decks: number; potential: number }[]> = {};
  const missing: string[] = [];
  for (const [identity, slug] of Object.entries(IDENTITY_PAGES)) {
    const p = await page(slug).catch(() => null);
    const views = (p?.container?.json_dict?.cardlists ?? []).flatMap((l) => l.cardviews);
    if (views.length === 0) { missing.push(`${identity} (${slug})`); continue; }
    const seen = new Set<string>();
    identities[identity] = views
      .filter((v) => v.name && !seen.has(v.name) && seen.add(v.name))
      .map((v) => ({ name: v.name.split(" // ")[0]!, decks: v.num_decks ?? 0, potential: v.potential_decks ?? 0 }))
      .sort((a, b) => b.decks / Math.max(1, b.potential) - a.decks / Math.max(1, a.potential));
    console.log(`${identity.padEnd(5)} ${slug.padEnd(12)} ${identities[identity]!.length} cards`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (Object.keys(identities).length === 0) throw new Error("EDHREC answered no identity -- not overwriting the snapshot");
  const snapshot = {
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: "https://edhrec.com/top/<identity> (most-played cards per colour identity; decks / potential decks)",
    identities,
  };
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`wrote ${Object.keys(identities).length} identities to ${out}${missing.length ? `; no page for ${missing.join(", ")}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error("gen-edhrec-staples-snapshot failed:", err); process.exit(1); });
}
