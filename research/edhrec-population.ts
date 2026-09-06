/** Pull a per-archetype deck population from EDHREC (owner ruling 2026-09-06, roadmap W19).
 *
 *  The 71 calibration decks are ONE owner's decks, and the archetype rows they give the template
 *  measurement are n=2 for superfriends and n=2 for landfall -- nothing to derive a target from. For
 *  every archetype the detector knows, this takes the theme's top five commanders on EDHREC and, for
 *  each, the THEMED AVERAGE DECK (a synthesized 99, consensus by construction) and ONE REAL DECK
 *  tagged with the theme (newest, bracket 2-3 preferred, a full deck). 150 decks, written as
 *  decklists beside the calibration set so `template-derive.ts --dir` can group them by theme.
 *
 *  Terms: EDHREC states none for these endpoints. One request per second, a browser UA, raw bodies
 *  cached on disk so a re-run costs nothing, and NEVER at runtime -- this is a one-off pull.
 *
 *    npx tsx research/edhrec-population.ts [--out packages/cli/decks/edhrec] [--themes a,b | --all] */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHETYPE_VOCABULARY } from "../packages/matcher/src/archetype-vocabulary.js";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : "packages/cli/decks/edhrec";
const CACHE = process.env.EDHREC_CACHE ?? ".edhrec-cache";
const PER_THEME = 5;

/** THE VOCABULARY IS THE THEME LIST (2026-09-06): every member with an EDHREC key, keyed by our
 *  slug for the output directory and by EDHREC's for the request. `--themes a,b` limits the pull;
 *  the default is the 15 the 2026-09-06 population already holds, so a re-run costs nothing, and
 *  `--all` takes every keyed member (one request per second: budget an hour and a half). Tribes
 *  (`KINDRED_TRIBES`) are not pulled: one kindred member does not need 135 populations. */
const ONLY = process.argv.includes("--themes") ? new Set(process.argv[process.argv.indexOf("--themes") + 1]!.split(",")) : undefined;
const DEFAULT_THEMES = new Set(["tokens", "aristocrats", "lifegain", "landfall", "spellslinger", "reanimator", "counters", "voltron", "combo", "superfriends", "enchantress", "artifacts", "midrange", "control", "stax"]);
const THEMES: { archetype: string; slug: string; tag: string }[] = ARCHETYPE_VOCABULARY
  .filter((r) => r.edhrec && (ONLY ? ONLY.has(r.slug) : process.argv.includes("--all") || DEFAULT_THEMES.has(r.slug)))
  .map((r) => ({ archetype: r.slug, slug: r.edhrec!.slug, tag: r.edhrec!.tag }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url: string): Promise<unknown> {
  const key = join(CACHE, url.replace(/^https?:\/\//, "").replace(/[^a-z0-9._-]+/gi, "_") + ".json");
  if (existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  const wait = 1000 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (edh-seer template population, one-off)" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = await res.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(key, JSON.stringify(body));
  return body;
}

type Cardview = { name: string; slug: string; url: string; num_decks: number };
type Deck = { commander?: string[]; commanders?: string[]; cards: Record<string, [string, number][]> };
type Row = { urlhash: string; savedate: string; bracket: number | null; tags: string[]; creature: number; instant: number; sorcery: number; artifact: number; enchantment: number; battle: number; planeswalker: number; land: number };

function decklist(commanders: string[], deck: Deck, header: string[]): string {
  const lines = header.map((h) => `# ${h}`);
  lines.push("", "Commander", ...commanders.map((c) => `1 ${c}`), "", "Deck");
  for (const group of Object.values(deck.cards)) for (const [name, qty] of group) lines.push(`${qty} ${name}`);
  return lines.join("\n") + "\n";
}
const total = (r: Row) => r.creature + r.instant + r.sorcery + r.artifact + r.enchantment + r.battle + r.planeswalker + r.land;

let written = 0;
const failed: string[] = [];
for (const t of THEMES) {
  // A THEME THAT 404s IS A GAP TO REPORT, NOT A RUN TO ABORT: over 214 themes some average deck or
  // index is missing, and the pull is an hour of rate-limited requests.
  let page: { container: { json_dict: { cardlists: { header: string; cardviews: Cardview[] }[] } } };
  try { page = (await get(`https://json.edhrec.com/pages/tags/${t.slug}.json`)) as typeof page; } catch (e) { failed.push(`${t.archetype}: ${(e as Error).message}`); continue; }
  const top = page.container.json_dict.cardlists.find((c) => c.header === "Top Commanders")?.cardviews.slice(0, PER_THEME) ?? [];
  const dir = join(OUT, t.archetype);
  mkdirSync(dir, { recursive: true });
  for (const c of top) try {
    const cmd = c.url.split("/")[2]!; // /commanders/<slug>/<theme>
    // The themed average deck.
    const avg = (await get(`https://json.edhrec.com/pages/average-decks/${cmd}/${t.slug}.json`)) as { deck: Deck };
    const avgCommanders = avg.deck.commander ?? avg.deck.commanders ?? [c.name];
    writeFileSync(join(dir, `${cmd}.avg.txt`), decklist(avgCommanders, avg.deck, [`edhrec average deck: https://edhrec.com/average-decks/${cmd}/${t.slug}`, `theme ${t.tag} (${c.num_decks} decks)`]));
    // One real deck: tagged with the theme, a full 99, bracket 2-3 first, newest first.
    const index = (await get(`https://json.edhrec.com/pages/decks/${cmd}.json`)) as { table: Row[] };
    // A partner pair leaves 98 cards in the 99; the theme page names the pair as "A // B".
    const size = 100 - c.name.split(" // ").length;
    const tagged = index.table.filter((r) => r.tags.includes(t.tag) && total(r) === size);
    const pick = [...tagged].sort((a, b) => Number(b.bracket === 2 || b.bracket === 3) - Number(a.bracket === 2 || a.bracket === 3) || b.savedate.localeCompare(a.savedate))[0];
    if (!pick) { console.log(`  ${t.archetype}/${cmd}: no real deck tagged ${t.tag} at 99 cards (${index.table.length} indexed)`); continue; }
    const real = (await get(`https://edhrec.com/api/deckpreview/${pick.urlhash}`)) as { deck: Deck; commanders: string[]; url: string; tags: string[]; bracket?: number };
    writeFileSync(join(dir, `${cmd}.real.txt`), decklist(real.commanders, real.deck, [`edhrec deck https://edhrec.com/deckpreview/${pick.urlhash} (source ${real.url})`, `tags ${real.tags.join(", ")}; bracket ${pick.bracket ?? "unset"}; saved ${pick.savedate}; ${tagged.length} tagged of ${index.table.length} indexed`]));
    written += 2;
  } catch (e) { failed.push(`${t.archetype}/${c.name}: ${(e as Error).message}`); }
  console.log(`${t.archetype}: ${top.map((c) => c.name).join(" · ")}`);
}
console.log(`\n${written} decklists under ${OUT}`);
if (failed.length) console.log(`\n${failed.length} failed:\n  ${failed.join("\n  ")}`);
