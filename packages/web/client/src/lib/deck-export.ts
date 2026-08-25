/** THE DECK, IN A FORM SOMETHING ELSE CAN READ.
 *
 *  Built from the RAW pasted text, not from the report: `CardSynergy` carries no copy count (one
 *  node per card, not per copy, since 322d129), so a report-derived export would silently turn
 *  "4 Rat Colony" into one Rat Colony. The text the user typed is the lossless source.
 *
 *  What it adds over that text is the `Commander` header, which a headerless EDH paste does not
 *  carry — `parseDecklistSections` infers the commander from sort order, and that inference is
 *  ours, not the next tool's. Headers are the ones Moxfield/Archidekt emit and the ones our own
 *  parser reads, so this round-trips both ways.
 *
 *  Persistence is deliberately NOT here: saving a deck is a builder+auth topic, and this is the
 *  interim answer — get it out, keep it elsewhere.
 */
export function deckExportText(commanders: string, decklist: string): string {
  const cmd = commanders.trim();
  const deck = decklist.trim();
  // No commander typed means the paste already carries whatever structure it has — a headerless
  // list whose first block IS the commander, or an explicit header. Writing a second `Commander`
  // section over either would be a wrong claim about the deck.
  if (!cmd) return `${deck}\n`;
  return `Commander\n${cmd}\n\nDeck\n${deck}\n`;
}
