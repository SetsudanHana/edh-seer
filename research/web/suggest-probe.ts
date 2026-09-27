/** Prints the report's build-gap suggestions for one deck -- the "You are N short on ramp" lists --
 *  through the browser's own path (`analyzeDeckStatic` then `suggestForDeck`), with each card's
 *  connection count and first reason. Reads the live site's `/static` unless `SUGGEST_STATIC` names
 *  another: a URL, or a local build directory (`build-static --out <dir>`, or `static-out`).
 *
 *    npx tsx research/web/suggest-probe.ts packages/cli/decks/calibration/inalla.txt [more decks...]
 *    SUGGEST_STATIC=static-out npx tsx research/web/suggest-probe.ts <deck.txt>
 *
 *  Free to re-run: no model call and no database. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeDeckStatic } from "../../packages/web/client/src/api.static.js";
import { suggestForDeck } from "../../packages/matcher/src/suggest-static.js";

const STATIC = process.env.SUGGEST_STATIC ?? "https://edhseer.cards/static";
const decks = process.argv.slice(2);
if (decks.length === 0) throw new Error("usage: suggest-probe.ts <decklist.txt> [...]");

// A LOCAL BUILD DIRECTORY SERVES ITSELF, so a `build-static --out` scratch build is measurable with
// no dev server: the manifest names the version directory, as the site's `/static` does.
const local = !/^https?:/.test(STATIC);
const fetchImpl: typeof fetch = local
  ? (async (url: string | URL | Request) => {
      const path = String(url).replace(/^file:\/\//, "");
      return existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 });
    }) as typeof fetch
  : fetch;
const base = local ? `file://${resolve(STATIC)}` : STATIC;

for (const deckPath of decks) {
  const data = await analyzeDeckStatic(readFileSync(deckPath, "utf8"), undefined, base, fetchImpl);
  const out = await suggestForDeck({ report: data.report, commanderColorIdentity: data.commanderColorIdentity, baseUrl: base, fetchImpl });
  for (const [group, cards] of Object.entries(out.build)) {
    console.log(`\n== ${deckPath.split("/").pop()} :: ${group}`);
    for (const c of cards) console.log(`  ${c.name.padEnd(34)} mv ${c.mv}  conn ${String(c.connections.length).padStart(3)}  ${c.reasons[0]?.text ?? ""}`);
  }
}
