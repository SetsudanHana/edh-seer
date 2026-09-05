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
 *    npx tsx packages/matcher/src/bin/edhrec-population.ts [--out packages/cli/decks/edhrec] */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : "packages/cli/decks/edhrec";
const CACHE = process.env.EDHREC_CACHE ?? ".edhrec-cache";
const PER_THEME = 5;

/** Our archetype -> EDHREC theme url slug and the display value its deck rows are tagged with.
 *  `goodstuff` has no EDHREC theme; `midrange` is the nearest and is flagged as such. `control` and
 *  `stax` are not archetypes the detector names -- they are the strategy rows the template needs
 *  (roadmap W19: "control decks run more interaction" had no population to measure on). */
const THEMES: { archetype: string; slug: string; tag: string }[] = [
  { archetype: "tokens", slug: "tokens", tag: "Tokens" },
  { archetype: "aristocrats", slug: "aristocrats", tag: "Aristocrats" },
  { archetype: "lifegain", slug: "lifegain", tag: "Lifegain" },
  { archetype: "landfall", slug: "landfall", tag: "Landfall" },
  { archetype: "spellslinger", slug: "spellslinger", tag: "Spellslinger" },
  { archetype: "reanimator", slug: "reanimator", tag: "Reanimator" },
  { archetype: "counters", slug: "plus-1-plus-1-counters", tag: "+1/+1 Counters" },
  { archetype: "voltron", slug: "voltron", tag: "Voltron" },
  { archetype: "combo", slug: "combo", tag: "Combo" },
  { archetype: "superfriends", slug: "planeswalkers", tag: "Planeswalkers" },
  { archetype: "enchantress", slug: "enchantress", tag: "Enchantress" },
  { archetype: "artifacts", slug: "artifacts", tag: "Artifacts" },
  { archetype: "goodstuff", slug: "midrange", tag: "Midrange" },
  { archetype: "control", slug: "control", tag: "Control" },
  { archetype: "stax", slug: "stax", tag: "Stax" },
];

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
for (const t of THEMES) {
  const page = (await get(`https://json.edhrec.com/pages/tags/${t.slug}.json`)) as { container: { json_dict: { cardlists: { header: string; cardviews: Cardview[] }[] } } };
  const top = page.container.json_dict.cardlists.find((c) => c.header === "Top Commanders")?.cardviews.slice(0, PER_THEME) ?? [];
  const dir = join(OUT, t.archetype);
  mkdirSync(dir, { recursive: true });
  for (const c of top) {
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
  }
  console.log(`${t.archetype}: ${top.map((c) => c.name).join(" · ")}`);
}
console.log(`\n${written} decklists under ${OUT}`);
