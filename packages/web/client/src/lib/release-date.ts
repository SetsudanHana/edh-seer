const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-13" -> "13 Nov 2026". By hand, not Intl: a date-only ISO string parses as UTC and a local formatter can shift the day.
 *  A LEAF (no imports) because `functions/` prerenders with it and has no node types. */
export const releaseDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month && d && y ? `${Number(d)} ${month} ${y}` : iso;
};
