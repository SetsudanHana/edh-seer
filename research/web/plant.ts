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
 *  several name keys -- and returns the text untouched when the shard holds none. THROWS when an entry
 *  for the card has no tags, which is "not applied", never a silent no-op. */
export function patchShardText(text: string, card: string, emit: unknown, add: (tags: unknown, emit: unknown) => void): string {
  const file = JSON.parse(text) as Record<string, { card?: { name?: string }; tags?: unknown }>;
  let hit = false;
  for (const entry of Object.values(file)) {
    if (entry?.card?.name !== card) continue;
    if (!entry.tags) throw new Error("PLANT NOT APPLIED: the " + card + " entry has no tags");
    add(entry.tags, emit);
    hit = true;
  }
  return hit ? JSON.stringify(file) : text;
}

/** Shard file text in, shard file text out; every entry that is not Lively Dirge is byte-equal in
 *  content. */
export function plantShardJson(file: string): string {
  return patchShardText(file, PLANT.card, PLANT.emit, addSiblingEmit as (t: unknown, e: unknown) => void);
}

/** What a route handler reports: the shard it patched (null = nothing yet) and every failure. */
export type PlantState = { applied: string | null; failures: string[] };

/** THE ONE ROUTE HANDLER, self-contained so the live-seat snippet embeds this very function.
 *
 *  It NEVER leaves a request unfulfilled: a patch that throws (PLANT ROTTED, a null `tags`, bad JSON)
 *  fulfils the original response and records the failure, because a handler that throws hangs the
 *  analysis silently. Headers: `route.fetch()` decodes gzip/br but keeps `content-encoding` and the
 *  stale `content-length`, and `fulfill` copies them verbatim -- a plain-JSON body labelled br/gzip
 *  fails in Chromium (ERR_CONTENT_DECODING_FAILED), so those three are dropped. */
export function makePlantHandler(
  card: string, emit: unknown,
  add: (tags: unknown, emit: unknown) => void,
  patch: (text: string, card: string, emit: unknown, add: (tags: unknown, emit: unknown) => void) => string,
  state: PlantState, note: (msg: string) => void,
) {
  return async (route: { fetch(): Promise<any>; fulfill(o: any): Promise<void>; fallback(): Promise<void>; request(): { url(): string } }) => {
    let res: any;
    let text: string;
    try {
      res = await route.fetch();
      if (!res.ok()) { await route.fulfill({ response: res }); return; }
      text = await res.text();
    } catch (e) {
      // A reset dev server or a timed-out fetch must not leave the request dangling.
      const msg = "PLANT NOT APPLIED: fetch failed: " + (e instanceof Error ? e.message : String(e));
      state.failures.push(msg);
      note(msg);
      await route.fallback();
      return;
    }
    if (!text.includes(card)) { await route.fulfill({ response: res, body: text, headers: stripped(res.headers()) }); return; }
    let body = text;
    try {
      body = patch(text, card, emit, add);
      if (body !== text) state.applied = /\/cards\/([0-9a-f]+)\.json/.exec(route.request().url())?.[1] ?? "?";
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = raw.startsWith("PLANT NOT APPLIED") ? raw : "PLANT NOT APPLIED: " + raw;
      state.failures.push(msg);
      note(msg);
      body = text;
    }
    await route.fulfill({ response: res, body, headers: stripped(res.headers()) });
    function stripped(h: Record<string, string>) {
      const out: Record<string, string> = {};
      for (const k of Object.keys(h)) if (!["content-encoding", "content-length", "transfer-encoding"].includes(k.toLowerCase())) out[k] = h[k];
      return out;
    }
  };
}

/** Rewrite the Lively Dirge shard on its way into every page of `context`. `note` receives each
 *  failure (the capture harness prints it as a NOTE line); read `state.applied` afterwards. */
export async function installPlant(context: BrowserContext, note: (msg: string) => void = (m) => console.warn(m)): Promise<PlantState> {
  const state: PlantState = { applied: null, failures: [] };
  await context.route("**/cards/*.json", makePlantHandler(PLANT.card, PLANT.emit, addSiblingEmit as (t: unknown, e: unknown) => void, patchShardText, state, note));
  return state;
}

/** The paste-able version for `browser_run_code_unsafe`, generated from the SAME functions. The page
 *  must already be on the site origin (service workers and `caches` are origin-scoped). It returns
 *  `{ applied, rendered, shard, failures }`; run the pod-fit seat only when `rendered` is true. */
export function plantSnippet(): string {
  return `async (page) => {
  const __name = (f) => f;
  const card = ${JSON.stringify(PLANT.card)};
  const consumer = ${JSON.stringify(PLANT.consumer)};
  const sentence = ${JSON.stringify(PLANT.sentence)};
  const emit = ${JSON.stringify(PLANT.emit)};
  const add = ${addSiblingEmit.toString()};
  const patch = ${patchShardText.toString()};
  const makeHandler = ${makePlantHandler.toString()};
  const state = { applied: null, failures: [] };
  // A service worker answers shard requests before Playwright's route sees them: remove it and its cache.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.context().route("**/cards/*.json", makeHandler(card, emit, add, patch, state, (m) => console.warn(m)));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForSelector("#read", { timeout: 60000 }).catch(() => {});
  // \`applied\` proves only the shard rewrite. The deployed bundle can differ from the local engine
  // seed-check ran against, so read the sentence off the page: it sits in ${PLANT.consumer}'s drawer
  // on the Cards page ("every way it works"), which a full-page search of the report cannot see.
  // A second page in the same context (so the route applies) leaves the seat's page where it was.
  let rendered = false;
  try {
    const p2 = await page.context().newPage();
    try {
      const u = new URL(page.url());
      u.pathname = "/analysis/cards";
      await p2.goto(u.toString());
      const link = p2.locator('a[data-card=' + JSON.stringify(consumer) + ']').first();
      await link.waitFor({ timeout: 60000 });
      await link.click({ timeout: 20000 });
      await p2.locator("[data-testid='card-inspector']").first().waitFor({ timeout: 20000 });
      const text = await p2.evaluate(() => {
        const ins = document.querySelector("[data-testid='card-inspector']");
        for (const d of Array.from(ins.querySelectorAll("details"))) d.open = true;
        return ins.innerText;
      });
      rendered = text.includes(sentence);
    } finally { await p2.close(); }
  } catch (e) { state.failures.push("PLANT NOT RENDERED: " + (e instanceof Error ? e.message : String(e))); }
  return { applied: state.applied !== null && !state.failures.some((f) => f.indexOf("PLANT NOT APPLIED") === 0), rendered, shard: state.applied, failures: state.failures };
}
`;
}

/** Run AFTER the pod-fit seat: the patched shard sits in Cache Storage and, in a persistent profile,
 *  would hand a later seat a live FALSE claim. */
export function cleanupSnippet(): string {
  return `async (page) => {
  await page.context().unroute("**/cards/*.json");
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  return "plant removed: route, service workers and caches cleared";
}
`;
}

if (process.argv[1]?.endsWith("plant.ts")) {
  if (process.argv.includes("--snippet")) process.stdout.write(plantSnippet());
  else if (process.argv.includes("--cleanup-snippet")) process.stdout.write(cleanupSnippet());
}
