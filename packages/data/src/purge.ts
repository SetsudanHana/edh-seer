/** MongoDB filter selecting non-gameplay junk card docs: doubled-name art/token
 *  printings ("Card // Card") and any doc whose oracle text is blank or the bare
 *  face-join sentinel. */
export function junkCardFilter(): Record<string, unknown> {
  return {
    $or: [
      { typeLine: "Card // Card" },
      { oracleText: { $in: ["", "//", "\n//\n"] } },
    ],
  };
}
