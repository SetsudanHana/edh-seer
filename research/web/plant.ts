/** THE POD-FIT SEAT'S PLANTED FALSE CLAIM, INJECTED BY THE HARNESS (issue #1251).
 *
 *  The seat self-calibrates: its report must carry one claim the owner hand-judged FALSE, so a round
 *  where it questions nothing shows the instrument went soft. Until 2026-10-17 that claim was a LIVE
 *  ENGINE BUG, and it rotted three times (Misty Rainforest -> Yuna, Lively Dirge -> Tinybones, then
 *  the Tinybones family, fixed in #1250). Owner, 2026-10-16: no live FALSE claims while the panel
 *  targets 100%. Owner, 2026-10-17: inject the plant instead. The engine, Mongo and the panel are
 *  untouched; only the card shard the BROWSER fetches is rewritten on its way in.
 *
 *  The plant restores the misreading judged FALSE on 2026-09-26: Lively Dirge fills YOUR graveyard,
 *  while Tinybones casts from the graveyard of the OPPONENT it damaged. It is added as a SIBLING emit
 *  (an opponent `mill` from the library) next to Lively Dirge's real `enters-graveyard` one; replacing
 *  the real emit would also remove two true links (Witch's Cottage, Mausoleum Secrets).
 *
 *  Three consumers, ONE definition of the patch (`addSiblingEmit`):
 *    - `seed-check.ts` applies `plantTags` to a Mongo analysis,
 *    - `ui-review-capture.ts` calls `installPlant(context)` on every browser context,
 *    - the live-seat dispatcher pastes the output of  `npx tsx research/web/plant.ts --snippet`
 *      into the Playwright MCP `browser_run_code_unsafe` tool.
 *
 *  SERVICE WORKER CAVEAT. `static-lookup.ts` fetches shards through Cache Storage, and in a PROD build
 *  the client registers a service worker (`packages/web/client/src/main.tsx`). Playwright's `route`
 *  does not see requests a service worker answers. The dev server is not PROD, so the capture harness
 *  is fine; the LIVE site is not, which is why the snippet unregisters workers, clears `caches` and
 *  reloads before the route can bite. */
import type { BrowserContext } from "@playwright/test";

export const PLANT = {
  card: "Lively Dirge",
  consumer: "Tinybones, the Pickpocket",
  sentence: "Lively Dirge puts cards into the graveyard that Tinybones, the Pickpocket can bring back",
  tag: /^graveyard-recursion/,
  /** The verdict this restores: owner FALSE 2026-09-26, subject mismatch (your graveyard vs. the
   *  graveyard of the opponent Tinybones' controller damaged). */
  verdict: "owner FALSE 2026-09-26, subject mismatch",
  deck: "packages/cli/decks/calibration/mari-takes-control.txt",
  /** Added next to the ability's `enters-graveyard` / `fromZone: "library"` emit. */
  emit: { verb: "mill", subject: { control: "opp", token: null, fromZone: "library" } },
};

type Tags = { abilities?: { emits?: { verb: string; subject?: { fromZone?: string | null } }[] }[] };

/** MUTATES `tags`. Self-contained on purpose: the live-seat snippet embeds `Function#toString()` of
 *  this, so it may reference nothing outside itself. Throws when no ability carries the emit to
 *  sit beside, i.e. when a derive change to the card has voided the plant. */
export function addSiblingEmit(tags: Tags, emit: unknown): void {
  let n = 0;
  for (const a of tags?.abilities ?? []) {
    const emits = a.emits ?? [];
    if (emits.some((e) => e.verb === "enters-graveyard" && e.subject?.fromZone === "library")) {
      emits.push(JSON.parse(JSON.stringify(emit)));
      a.emits = emits;
      n++;
    }
  }
  if (n === 0) throw new Error("PLANT ROTTED: no ability of Lively Dirge carries an enters-graveyard emit from the library; its derive changed, so the plant must be re-chosen");
}

/** Pure: a copy of `tags` with the sibling emit added. Throws "PLANT ROTTED: ..." when it cannot. */
export function plantTags<T>(tags: T): T {
  const copy = JSON.parse(JSON.stringify(tags)) as T;
  addSiblingEmit(copy as unknown as Tags, PLANT.emit);
  return copy;
}

/** Self-contained (snippet-embedded). Patches every entry whose card is `card` -- a card sits under
 *  several name keys -- and returns the text untouched when the shard holds none. */
export function patchShardText(text: string, card: string, emit: unknown, add: (tags: unknown, emit: unknown) => void): string {
  const file = JSON.parse(text) as Record<string, { card?: { name?: string }; tags?: unknown }>;
  let hit = false;
  for (const entry of Object.values(file)) {
    if (entry?.card?.name === card && entry.tags) { add(entry.tags, emit); hit = true; }
  }
  return hit ? JSON.stringify(file) : text;
}

/** Shard file text in, shard file text out; every entry that is not Lively Dirge is byte-equal in
 *  content. */
export function plantShardJson(file: string): string {
  return patchShardText(file, PLANT.card, PLANT.emit, addSiblingEmit as (t: unknown, e: unknown) => void);
}

/** Rewrite the Lively Dirge shard on its way into every page of `context`. */
export async function installPlant(context: BrowserContext): Promise<void> {
  await context.route("**/cards/*.json", async (route) => {
    const res = await route.fetch();
    if (!res.ok()) { await route.fulfill({ response: res }); return; }
    const text = await res.text();
    if (!text.includes(PLANT.card)) { await route.fulfill({ response: res, body: text }); return; }
    await route.fulfill({ response: res, body: plantShardJson(text) });
  });
}

/** The paste-able version for `browser_run_code_unsafe`, generated from the SAME functions. */
export function plantSnippet(): string {
  return `async (page) => {
  const __name = (f) => f;
  const card = ${JSON.stringify(PLANT.card)};
  const emit = ${JSON.stringify(PLANT.emit)};
  const add = ${addSiblingEmit.toString()};
  const patch = ${patchShardText.toString()};
  // A service worker answers shard requests before Playwright's route sees them: remove it and its cache.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.context().route("**/cards/*.json", async (route) => {
    const res = await route.fetch();
    if (!res.ok()) { await route.fulfill({ response: res }); return; }
    const text = await res.text();
    await route.fulfill({ response: res, body: text.includes(card) ? patch(text, card, emit, add) : text });
  });
  await page.reload();
  return "plant installed: ${PLANT.card} -> ${PLANT.consumer}";
}
`;
}

if (process.argv[1]?.endsWith("plant.ts") && process.argv.includes("--snippet")) {
  process.stdout.write(plantSnippet());
}
