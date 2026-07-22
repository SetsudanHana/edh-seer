/** MongoDB filter selecting non-gameplay junk card docs: doubled-name art/token
 *  printings ("Card // Card") and any doc whose oracle text is the bare
 *  face-join sentinel. Deliberately excludes blank oracle text — that also
 *  matches real vanilla creatures (e.g. Grizzly Bears). */
export function junkCardFilter(): Record<string, unknown> {
  return {
    $or: [
      { typeLine: "Card // Card" },
      { oracleText: { $in: ["//", "\n//\n"] } },
    ],
  };
}
