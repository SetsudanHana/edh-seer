/** A WOULD-ENTER REPLACEMENT HAPPENS BEFORE THE THING IS ON THE BATTLEFIELD (CR 614.1a, 614.6; #1575). "If this creature would enter and it wasn't cast ..., exile it instead" (Primeval Spawn), "If a nontoken
 *  creature would enter and it wasn't cast, exile it instead" (Containment Priest, Mistcaller, Hallowed Moonlight): the card goes to exile from wherever it was, and it never leaves the battlefield, so the
 *  exile derives `exiled` and no `leaves`. A creature that was never there cannot feed a "whenever a creature leaves the battlefield" payoff.
 *  CEILING: a sentence that says "would enter" and then "instead" is the replacement; a card that also exiles a permanent already on the battlefield in the SAME clause text loses that leave. Linear scans only. */
export function replacesEntry(clauseText: string): boolean {
  const lower = clauseText.toLowerCase();
  const at = lower.indexOf(" would enter");
  return at >= 0 && lower.indexOf(" instead", at) > at;
}
