import { DeckFetchError, readDeckJson } from "./deck-source.js";
import type { DeckSections, FetchFn } from "./deck-source.js";

/** Archidekt asks for no key and no whitelisted agent, but it does ask for one request a second,
 *  so identify ourselves anyway: an anonymous client is the one they cannot warn before blocking. */
const USER_AGENT = "edh-seer (+https://github.com/SetsudanHana/edh-seer)";

interface ArchidektCategory {
  name?: unknown;
  isPremier?: unknown;
  includedInDeck?: unknown;
}
interface ArchidektCard {
  quantity?: unknown;
  categories?: unknown;
  /** The site's own companion flag (CR 702.139), per card -- see `archidektDeckToSections`. */
  companion?: unknown;
  card?: { oracleCard?: { name?: unknown } };
}
interface ArchidektDeck {
  cards?: unknown;
  categories?: unknown;
}

export function parseArchidektId(input: string): string | null {
  const m = input.match(/archidekt\.com\/decks\/(\d+)/i);
  if (m) return m[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}

function quantityOf(card: ArchidektCard): number {
  const raw = typeof card.quantity === "number" ? card.quantity : 1;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

function categoryNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
}

/** Archidekt has no boards. It has free-text categories the player invents ("Sac Outlet", "Fodder",
 *  "dont have"), and TWO FLAGS that carry the only structure worth reading:
 *
 *  - `includedInDeck: false` marks the categories that are not the deck. Sideboard and Maybeboard
 *    carry it by default. MEASURED on a real 94-entry deck: 11 of its cards sit in one, so taking
 *    `.cards[]` whole imports eleven cards the player did not build with.
 *  - `isPremier: true` marks the commander category. Reading the literal name "Commander" instead
 *    would break on a renamed category; the flag is what the site itself keys on.
 *  - `companion: true` ON THE CARD marks the companion, outside the 100 (measured 2026-09-23 on three
 *    real Lurrus decks). It is read FIRST, before both flags above: one of those decks marked its
 *    "Companion" category `isPremier`, which would have made Lurrus a second commander, and a
 *    companion kept in a Sideboard the deck excludes is still the deck's companion. A category name
 *    alone ("Companion", "Sideboard") is never read as one -- the player invents those. */
export function archidektDeckToSections(json: unknown): DeckSections {
  const deckJson = json as ArchidektDeck | null;
  const cards = deckJson?.cards;
  if (!Array.isArray(cards)) {
    throw new Error("Archidekt response shape changed: no cards array");
  }
  const categories: ArchidektCategory[] = Array.isArray(deckJson?.categories) ? deckJson.categories : [];
  const named = (pick: (c: ArchidektCategory) => boolean): Set<string> =>
    new Set(
      categories.filter(pick).map((c) => c.name).filter((n): n is string => typeof n === "string"),
    );
  const excluded = named((c) => c.includedInDeck === false);
  const premier = named((c) => c.isPremier === true);

  const commanders: string[] = [];
  const deck: string[] = [];
  const companions: string[] = [];
  for (const entry of cards as ArchidektCard[]) {
    const cats = categoryNames(entry?.categories);
    const isCompanion = entry?.companion === true;
    if (!isCompanion && cats.some((c) => excluded.has(c))) continue;
    const name = entry?.card?.oracleCard?.name;
    if (typeof name !== "string" || name === "") {
      throw new Error("Archidekt response shape changed: card has no card.oracleCard.name");
    }
    const target = isCompanion ? companions : cats.some((c) => premier.has(c)) ? commanders : deck;
    for (let i = 0; i < quantityOf(entry); i++) target.push(name);
  }
  return { commanders, deck, ...(companions.length > 0 ? { companions } : {}) };
}

export async function fetchArchidektDeck(
  id: string,
  fetchImpl: FetchFn = fetch,
): Promise<DeckSections> {
  // BARE HOST, NOT `www.`: www.archidekt.com answers /api/ with a 301, which `fetch` in a Worker
  // does not follow the way Python's `requests` silently does.
  const res = await fetchImpl(`https://archidekt.com/api/decks/${encodeURIComponent(id)}/`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new DeckFetchError("Archidekt", res.status);
  return archidektDeckToSections(await readDeckJson(res, "Archidekt"));
}
