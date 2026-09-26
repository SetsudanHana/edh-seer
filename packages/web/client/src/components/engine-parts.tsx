import { useEffect, useState } from "react";
import type { EngineCard, Link, Repeat } from "../lib/engine-model.js";
import { ReasonText, useCardDrawer } from "./card-drawer.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { cardImageUrl } from "./card-node.js";

/** The pieces the Overview and the Orbit draw a card and a claim with, so the two read alike. */

export const REPEAT_WORD: Record<Repeat, string> = { static: "always on", triggered: "every time", activated: "on demand", oneshot: "once" };
export const REPEAT_MEANS: Record<Repeat, string> = { static: "while both are out", triggered: "each time it happens", activated: "when you pay for it", oneshot: "happens once" };

export function Badge({ repeat }: { repeat: Repeat }) {
  return (
    <span className={`eyebrow mr-2 inline-block whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 align-[1px] ${
      repeat === "oneshot" ? "border-dashed border-(--muted) text-(--muted)" : "border-(--separator) bg-(--surface-secondary) text-(--foreground)"
    }`}>{REPEAT_WORD[repeat]}</span>
  );
}

export function RepeatKey() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-(--muted)">
      {(["static", "triggered", "activated", "oneshot"] as const).map((r) => <span key={r}><Badge repeat={r} />{REPEAT_MEANS[r]}</span>)}
    </p>
  );
}

export function Lines({ links }: { links: readonly Link[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {links.map((l) => <li key={`${l.from}|${l.to}|${l.tag}|${l.text}`}><Badge repeat={l.repeat} /><ReasonText text={l.text} /></li>)}
    </ul>
  );
}

export function Art({ card, size }: { card: EngineCard; size: number }) {
  return card.art
    ? <img src={card.art} alt="" loading="lazy" width={size} height={size} className="shrink-0 rounded-full object-cover border-2 border-(--background)" style={{ width: size, height: size }} />
    : <span aria-hidden="true" className="shrink-0 rounded-full bg-(--surface-secondary) border-2 border-(--background)" style={{ width: size, height: size }} />;
}

/** THE CARD AS A PLAYER KNOWS IT: the whole printed card, never the art crop -- the full card
 *  carries its own artist credit and the corpus has none to print (see `CardArt`). Tapping it opens
 *  the card, like its name does. A card with no image (a token the corpus has no art for) falls back
 *  to a plain frame with its name, so a pair never shows a hole. */
export function CardFace({ card, className }: { card: EngineCard; className: string }) {
  const { open, known } = useCardDrawer();
  const src = card.art ? cardImageUrl(card.art) : null;
  const face = src
    ? <img src={src} alt={card.name} loading="lazy" decoding="async" width={488} height={680} className="block aspect-[488/680] h-auto w-full rounded-[4.5%/3.3%] shadow-md shadow-black/40" />
    : <span className="flex aspect-[488/680] w-full items-end rounded-[6%/4.4%] border border-(--separator) bg-(--surface-secondary) p-1.5 text-[10px] leading-tight">{card.name}</span>;
  return known.has(card.name)
    ? <button type="button" onClick={() => open(card.name)} aria-label={`Open ${card.name}`} className={`shrink-0 transition-transform hover:-translate-y-0.5 ${className}`}>{face}</button>
    : <span className={`shrink-0 ${className}`}>{face}</span>;
}

/** THE TEXT, ONE TAP AWAY: kept in the page, so checking a claim never waits on a fetch. */
export function ReadCards({ cards }: { cards: EngineCard[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-1.5 text-(--muted) hover:text-(--foreground)">{cards.length === 1 ? "Read the card" : "Read both cards"}</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">{cards.map((c) => <CardText key={c.id} card={c} />)}</div>
    </details>
  );
}

/** THE PRINTED CARD, in words, beside the claim about it. */
export function CardText({ card }: { card: EngineCard }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius) border border-(--separator) bg-(--background) px-2.5 py-2 text-xs leading-relaxed">
      <span className="flex items-baseline justify-between gap-2">
        <b className="text-sm">{card.name}{card.isToken ? <span className="text-(--muted) font-normal"> (token)</span> : null}</b>
        {card.manaCost ? <ManaSymbols cost={card.manaCost} /> : null}
      </span>
      {card.typeLine ? <span className="text-(--muted)">{card.typeLine}</span> : null}
      {card.text ? <p className="whitespace-pre-line">{card.text}</p> : null}
    </div>
  );
}

/** Whether the screen is phone-width, following resizes. */
export function useNarrow(): boolean {
  const query = "(max-width: 639px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
