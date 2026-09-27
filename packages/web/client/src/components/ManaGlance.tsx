import type { ReactNode } from "react";
import { policyBand } from "@edh-seer/engine/percent";
import type { DeckReport } from "../types.js";
import { landHandProbabilities } from "../lib/land-math.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { CardName } from "./card-drawer.js";

/** THE MANABASE, ANSWERED FIRST (owner, 2026-09-27: "manabase is also a section that no one is going
 *  to read through"). The chapter was five panels of figures and the paragraphs that qualify them,
 *  2,400px on a phone, and a player came to it with five questions: enough lands, enough of each
 *  colour, will my opening hands work, will I have the mana, which card will I struggle to cast. Each
 *  gets one tile, from the same numbers the panels print; the panels are kept, behind "Show the
 *  numbers", for whoever wants the working. */
export function ManaGlance({ deckMath, manaAvailability, landCount, deckSize }: {
  deckMath?: DeckReport["deckMath"];
  manaAvailability?: DeckReport["manaAvailability"];
  landCount: number;
  deckSize: number;
}) {
  const tiles: ReactNode[] = [];
  const lands = deckMath?.lands;
  if (lands) {
    const off = lands.actual - lands.target;
    tiles.push(
      <Tile key="lands" label="Lands" warn={Math.abs(off) > 2} big={String(lands.actual)}
        sub={Math.abs(off) <= 2 ? `wants ${lands.target}: on target` : `wants ${lands.target}: ${Math.abs(off)} ${off < 0 ? "short" : "over"}`} />,
    );
  }
  const colours = deckMath?.colors ?? [];
  if (colours.length) {
    // The colour furthest short of what its earliest demanding card needs; none short says so.
    const short = colours.filter((c) => c.worst && c.worst.available < c.worst.required)
      .sort((a, b) => (b.worst!.required - b.worst!.available) - (a.worst!.required - a.worst!.available))[0];
    tiles.push(short?.worst ? (
      <Tile key="colours" label="Weakest colour" warn
        big={<span className="inline-flex items-center gap-1.5"><ManaSymbols cost={`{${short.color}}`} />{short.worst.available}<span className="text-sm text-(--muted)">/{short.worst.required}</span></span>}
        sub={<>sources by turn {short.worst.turn}, for {short.worst.cards === 1 ? "a card" : `${short.worst.cards} cards`} wanting <ManaSymbols cost={`{${short.color}}`.repeat(short.worst.pips)} /></>} />
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
  if (h) {
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
