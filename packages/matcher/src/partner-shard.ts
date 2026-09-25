/** WHICH SHARD A SLUG LIVES IN, AND NOTHING ELSE.
 *
 *  ITS OWN FILE BECAUSE OF WHO IMPORTS IT. The build and the browser take it from
 *  `partners-core.ts`, which also pulls in `directedReasons` and therefore `edges.ts` -- 126 KB of
 *  matcher. The Cloudflare Pages Function that pre-renders a card page needs the shard rule and
 *  nothing else, and a Function bundle has a 1 MB limit, so it imports this module directly. One
 *  definition either way: a second copy of the hash in the Function is a URL that works until the
 *  day the two disagree, and then works for exactly half the corpus. */

/** SMALLER THAN THE CARD SHARDS ON PURPOSE. The deploy is 18,457 files against a 20,000 cap, so the
 *  partner artifact has room for a few thousand; 2,048 leaves headroom at ~7 records per shard. */
export const PARTNER_SHARD_COUNT = 2_048;

/** HOW MANY PARTNERS A CARD PAGE NEEDS BEFORE IT IS PROMISED TO A SEARCH ENGINE.
 *
 *  Below this the page is still served and still reachable; it is withheld from the sitemap and
 *  carries `noindex`, because a page whose whole body is one or two sentences beside a type line
 *  is thin content, and 17,000 near-identical thin pages discount the ones that are not.
 *
 *  THREE, from the artifact's own shape (measured 2026-09-08, 16,715 records): 10.6% have no
 *  partners, 3.3% one, 1.1% two, 24.2% exactly three, 56.2% six or more. Three is where a staple
 *  like Skullclamp sits, so the floor is set just under that tier: it withholds the 736 cards and
 *  157 commanders on one or two partners and nothing above. HERE, not in `partners-core.ts`,
 *  because the edge (`render.ts`) makes the same decision per request and imports only this file. */
export const MIN_INDEXABLE_PARTNERS = 3;

/** Same FNV-1a as `shardOf`, different modulus -- one rule, imported by the build, the browser and
 *  the edge, so none of the three can drift about where a page lives. */
export function partnerShardOf(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % PARTNER_SHARD_COUNT).toString(16).padStart(3, "0");
}

/** A JOB, IN THE REPORT'S OWN WORDS. Ramp, draw, removal and wipes help every deck, so the engine
 *  COUNTS them rather than pairing them with everything (how-it-works, "What it won't pretend to
 *  know"). A staple like Sol Ring therefore has no partners at all, and its page used to say only
 *  "No standout pairings" -- a dead end on the most searched cards in the format (review
 *  2026-09-25). The job is the honest answer to "what does this card do in my deck", so the page
 *  says it, and a page that can say it is no longer thin.
 *
 *  ORDERED: a card with several roles is named by the first one here. `tally` is the row the deck
 *  report counts it under, so the sentence points at a number the reader can go and find. `burn`
 *  and `stax` are build categories with no tally row, so they name no job. */
const JOBS: readonly { role: string; noun: string; tally: string }[] = [
  { role: "ramp", noun: "ramp", tally: "Ramp" },
  { role: "boardWipe", noun: "a board wipe", tally: "Board wipes" },
  { role: "targetedRemoval", noun: "removal", tally: "Interaction" },
  { role: "stackInteraction", noun: "interaction", tally: "Interaction" },
  { role: "protection", noun: "protection", tally: "Interaction" },
  { role: "graveyardHate", noun: "graveyard hate", tally: "Interaction" },
  { role: "tutor", noun: "a tutor", tally: "Consistency" },
  { role: "draw", noun: "card draw", tally: "Consistency" },
  { role: "cardSelection", noun: "card selection", tally: "Consistency" },
  { role: "impulseDraw", noun: "card draw", tally: "Consistency" },
];
// NOT `lands`: every land carries that role, and "X is a land" would promise a search engine
// thousands of pages that say nothing a type line does not.

export interface CardJob { noun: string; tally: string }

/** The job a card's build roles name, or null when none of them is one the report counts. */
export function jobOf(roles: readonly string[] | undefined): CardJob | null {
  if (!roles || roles.length === 0) return null;
  const j = JOBS.find((x) => roles.includes(x.role));
  return j ? { noun: j.noun, tally: j.tally } : null;
}

/** The sentence a card page prints for a job, shared by the edge block and the React page. */
export function jobSentence(name: string, job: CardJob): string {
  return `${name} is ${job.noun}. It helps almost every deck, so EDH Seer counts it toward your `
    + `${job.tally} total instead of pairing it with specific cards. Paste your deck to see whether `
    + `you are over or under.`;
}

/** THE ONE INDEXING RULE, read by the build (sitemap and `thin`) and the edge (`noindex`), so the
 *  two cannot disagree: enough partners, or a job the page can explain. */
export function isIndexableCard(partners: number, roles: readonly string[] | undefined): boolean {
  return partners >= MIN_INDEXABLE_PARTNERS || jobOf(roles) !== null;
}
