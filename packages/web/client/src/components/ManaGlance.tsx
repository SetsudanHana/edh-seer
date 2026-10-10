import type { ReactNode } from "react";
import { policyBand } from "@edh-seer/engine/percent";
import type { DeckReport } from "../types.js";
import { bandState } from "../lib/deck-gauge.js";
import { landHandProbabilities } from "../lib/land-math.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { CardName } from "./card-drawer.js";
import { NAME as COLOUR_NAME } from "../lib/findings.js";

/** THE MANABASE, ANSWERED FIRST (owner, 2026-09-27: "manabase is also a section that no one is going
 *  to read through"). The chapter was five panels of figures and the paragraphs that qualify them,
 *  2,400px on a phone, and a player came to it with five questions: enough lands, enough of each
 *  colour, will my opening hands work, will I have the mana, which card will I struggle to cast. Each
 *  gets one tile, from the same numbers the panels print; the panels are kept, behind "Show the
 *  numbers", for whoever wants the working. */
/** Which colour problem it is -- speed or count -- then the demand and the sources behind it. */
function ColourVerdict({ c, worst }: { c: { color: string; supplied: number }; worst: { pips: number; turn: number; required: number; available: number; cards: number } }) {
  const colour = (COLOUR_NAME[c.color] ?? c.color).toLowerCase();
  const demand = <>{worst.cards === 1 ? "A card" : `${worst.cards} cards`} wanting <ManaSymbols cost={`{${c.color}}`.repeat(worst.pips)} /> {worst.cards === 1 ? "needs" : "need"} {worst.required} by turn {worst.turn}.</>;
  if (c.supplied >= worst.required) {
    return <><span className="font-medium">Enough {colour}, but not in time:</span> you run {c.supplied} {colour} sources and only {worst.available} can tap by turn {worst.turn} (tapped lands, and rocks you couldn&apos;t have cast yet, don&apos;t count). {demand}</>;
  }
  return <><span className="font-medium">Short of {colour}:</span> you run {c.supplied} {colour} sources{c.supplied > worst.available ? `, ${worst.available} of them in time for turn ${worst.turn}` : ""}. {demand}</>;
}

export function ManaGlance({ deckMath, manaAvailability, landCount, deckSize }: {
  deckMath?: DeckReport["deckMath"];
  manaAvailability?: DeckReport["manaAvailability"];
  landCount: number;
  deckSize: number;
}) {
  const tiles: ReactNode[] = [];
  const lands = deckMath?.lands;
  if (lands) {
    // ONE READING OF THE LAND COUNT (#759): the Lands dial's, which is the score's own ±LAND_BAND.
    // This tile had its own ±2, so 34 against 37 was "3 short" here and full marks on the dial.
    const reading = bandState(lands.actual, lands.target);
    tiles.push(
      <Tile key="lands" label="Lands" warn={reading.tone !== "success"} big={String(lands.actual)}
        sub={`wants ${lands.target}: ${reading.label}`} />,
    );
  }
  const colours = deckMath?.colors ?? [];
  if (colours.length) {
    // The colour furthest short of what its earliest demanding card needs; none short says so.
    const short = colours.filter((c) => c.worst && c.worst.available < c.worst.required)
      .sort((a, b) => (b.worst!.required - b.worst!.available) - (a.worst!.required - a.worst!.available))[0];
    tiles.push(short?.worst ? (
      <Tile key="colours" label="Weakest colour" warn
        // NO SLASH (#1033): "30 /37" read as 30 of 37 lands even with the line below naming both
        // numbers, so the figure says it in words.
        big={<span className="inline-flex items-center gap-1.5"><ManaSymbols cost={`{${short.color}}`} />{short.worst.available}<span className="text-sm text-(--muted)"> of {short.worst.required} needed</span></span>}
        // THE VERDICT FIRST (persona round 2026-10-07): "need 37 … You run 38, and 30 of them can tap by
        // then" left the seat asking "more black lands or fewer tapped ones?", and the Improve finding
        // two chapters down already knew: a deck that runs enough of the colour has a SPEED problem.
        // The tile says which problem it is, in the finding's own words, then the numbers.
        sub={<ColourVerdict c={short} worst={short.worst} />} />
    ) : (
      <Tile key="colours" label="Colours" big={<span className="inline-flex gap-0.5">{colours.map((c) => <ManaSymbols key={c.color} cost={`{${c.color}}`} />)}</span>}
        sub="enough sources for every card" />
    ));
  }
  if (landCount > 0 && deckSize > 0) {
    const probs = landHandProbabilities(landCount, deckSize);
    // Two to four lands is the hand a player keeps without thinking.
    const keep = (probs[2] ?? 0) + (probs[3] ?? 0) + (probs[4] ?? 0);
    tiles.push(<Tile key="hands" label="Opening hands" warn={keep < 0.7} big={`${Math.round(keep * 100)}%`} sub="have 2 to 4 lands" />);
  }
  const h = manaAvailability?.headline;
  const need = manaAvailability?.need;
  if (need) {
    // THE DECK'S OWN NEED (owner 2026-10-10, #1151): can I pay for MY spells on time. The fixed
    // 6-by-6 benchmark is the ramp figure in "Show the numbers".
    tiles.push(<Tile key="mana" label="Mana" big={policyBand(need.low, need.high)}
      sub={`to make ${need.mana} mana by turn ${need.turn}, enough for ${Math.round(need.share * 100)}% of your spells`} />);
  } else if (h) {
    tiles.push(<Tile key="mana" label="Mana" big={policyBand(h.low, h.high)} sub={`to make ${h.mana} mana by turn ${h.turn}`} />);
  }
  const hardest = [...(deckMath?.castability.cards ?? [])].sort((a, b) => a.castable.high - b.castable.high)[0];
  if (hardest) {
    tiles.push(
      <Tile key="cast" label="Hardest cast" warn={hardest.castable.high < 0.5} big={policyBand(hardest.castable.low, hardest.castable.high)}
        sub={<><CardName name={hardest.name} /> on turn {hardest.turn}</>} />,
    );
  }
  if (!tiles.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2" data-testid="mana-glance">{tiles}</div>
  );
}

function Tile({ label, big, sub, warn }: { label: string; big: ReactNode; sub: ReactNode; warn?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-(--radius) border px-3 py-2.5 ${warn ? "border-(--warning)" : "border-(--separator)"}`} data-testid="mana-tile">
      <span className="eyebrow text-(--muted)">{label}</span>
      <span className={`stat-num text-2xl leading-none ${warn ? "text-(--warning)" : ""}`}>{big}</span>
      <span className="text-xs text-(--muted)">{sub}</span>
    </div>
  );
}
