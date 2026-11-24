// The ways a card can pair as a second commander (CR 702.124), read from its printed oracle text and type line.
// String operations only, no regular expression: a line is classified by what it STARTS with. ONE READER FOR BOTH
// CALLERS (#1798): the `partner` search field and `legality.ts`'s `pairingLicense` import this, so the deck report and
// the search can no longer disagree about a bare "Partner" line or a "Partner—<label>" line with no reminder text.
// The kinds are the `partner` search field's values.
//
//   partner               "Partner (You can have two commanders if both have partner.)", or a bare "Partner" line (Jeska, Tevesh Szat, Akroma)
//   partner-with          "Partner with <name>"
//   <label>               "Partner—<label> (…)": the label after the dash, as `friends-forever`, `character-select`,
//                         `survivors`, `father-son`. Read, not listed: a group printed next year appears with no code.
//   chooses-background    "Choose a Background"
//   background            the type line says Background (CR 702.124k: the second commander beside a card that chooses one)
//   doctors-companion     "Doctor's companion"
//
// A card prints at most a few; the answer is every kind it prints, sorted, each once.

const DASH = "—";

/** `Father & Son` -> `father-son`: lower case words joined by single hyphens. */
export function slugOfLabel(label: string): string {
  const parts: string[] = [];
  let word = "";
  for (const ch of label.toLowerCase()) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) word += ch;
    else if (word !== "") { parts.push(word); word = ""; }
  }
  if (word !== "") parts.push(word);
  return parts.join("-");
}

/** The kinds that are not a `Partner—<label>` group. Everything else `partnerKindsOf` returns IS a group label's
 *  slug, and two cards print the same group when they share one (CR 702.124i). */
export const FIXED_KINDS: ReadonlySet<string> = new Set(["partner", "partner-with", "chooses-background", "background", "doctors-companion"]);

/** The `Partner—<label>` groups a card prints, as slugs. */
export const partnerGroupsOf = (card: { oracleText?: string; typeLine?: string }): string[] =>
  partnerKindsOf(card).filter((k) => !FIXED_KINDS.has(k));

/** Every pairing kind a card prints. `typeLine` is the whole line (`A // B` for two faces). */
export function partnerKindsOf(card: { oracleText?: string; typeLine?: string }): string[] {
  const kinds = new Set<string>();
  for (const raw of (card.oracleText ?? "").split("\n")) {
    const line = raw.trim().toLowerCase();
    if (line === "partner" || line.startsWith("partner (")) kinds.add("partner");
    else if (line.startsWith("partner with ")) kinds.add("partner-with");
    else if (line.startsWith(`partner${DASH}`)) {
      const open = line.indexOf("(");
      const slug = slugOfLabel(line.slice(`partner${DASH}`.length, open < 0 ? undefined : open));
      if (slug !== "") kinds.add(slug);
    } else if (line.startsWith("choose a background")) kinds.add("chooses-background");
    else if (line.startsWith("doctor's companion")) kinds.add("doctors-companion");
  }
  if ((card.typeLine ?? "").toLowerCase().includes("background")) kinds.add("background");
  return [...kinds].sort();
}
