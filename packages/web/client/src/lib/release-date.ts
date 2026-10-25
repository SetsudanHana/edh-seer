const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-13" -> "13 Nov 2026". By hand, not Intl: a date-only ISO string parses as UTC and a local formatter can shift the day.
 *  A LEAF (no imports) because `functions/` prerenders with it and has no node types. */
export const releaseDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month && d && y ? `${Number(d)} ${month} ${y}` : iso;
};

/** The browser's LOCAL calendar date, YYYY-MM-DD: what "released yet?" means to the person reading. The prerender passes its own (the request's UTC date). */
export const localToday = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** An upcoming card's date has come (ISO dates sort as strings). Scryfall can lag a release, so a released card may still read not legal. */
export const isReleased = (iso: string, today: string): boolean => iso <= today;

/** THE ONE LINE A CARD PAGE SAYS ABOUT AN UPCOMING CARD (owner 2026-10-25). Before the date it is not out;
 *  on or after, it is out but our Scryfall snapshot has not caught up, and "not yet released" would be false. */
export const upcomingLine = (iso: string, today: string): string =>
  isReleased(iso, today)
    ? `Released ${releaseDate(iso)} — not yet legal in our card data`
    : `Not yet released — ${releaseDate(iso)}`;
