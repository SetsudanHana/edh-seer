import { useRef, useState } from "react";
import { useCardDrawer } from "./card-drawer.js";
import { cardLines, PopMenu, type MenuItem } from "./pop-menu.js";

export { cardLines, PopMenu, type MenuItem } from "./pop-menu.js";

/** The lines every card list offers for a card, by its physical name. Only lines that can work for
 *  this card: a name the report does not carry gets its page and its name, nothing else. */
export function useCardMenu(): (name: string) => MenuItem[] {
  const { open, known } = useCardDrawer();
  return (name) => cardLines(name, known.has(name) ? () => open(name) : undefined);
}

/** The "⋯" beside a card in a list. `extra` lines come first: what this list alone can do. */
export function CardMenuButton({ name, extra, className = "" }: { name: string; extra?: MenuItem[]; className?: string }) {
  const lines = useCardMenu();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const openMenu = () => {
    const r = button.current?.getBoundingClientRect();
    setAt({ x: r ? r.right : 0, y: r ? r.bottom + 4 : 0 });
  };
  return (
    <>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={at !== null} aria-label={`More for ${name}`}
        className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-(--radius) text-base leading-none text-(--muted) hover:bg-(--surface-secondary) hover:text-(--foreground) ${className}`}
        onClick={(e) => { e.stopPropagation(); if (at) setAt(null); else openMenu(); }}>
        <span aria-hidden="true">⋯</span>
      </button>
      {at ? (
        <PopMenu x={at.x} y={at.y} align="end" title={name} items={[...(extra ?? []), ...lines(name)]}
          onClose={(back) => { setAt(null); if (back) button.current?.focus(); }} />
      ) : null}
    </>
  );
}
