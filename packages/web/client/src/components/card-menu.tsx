import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slugOf } from "@edh-seer/matcher/slug";
import { useCardDrawer } from "./card-drawer.js";

import { External } from "./icons.js";
/** ONE MENU FOR A CARD, WHEREVER THE CARD IS LISTED (owner, 2026-09-27: the map's right-click menu,
 *  then "add the ⋯ menu to the other card lists too"). A list row is plain page, where taking over
 *  the browser's own right-click would get in the way, so a list offers the same lines behind a
 *  small "⋯" button: read the card (its links drawn in the drawer), pin it, open its page, copy its name. */

/** One line of a menu: an action, or a link that opens in a new tab. */
export interface MenuItem { label: string; run?: () => void; href?: string }


/** The lines every card list offers for a card, by its physical name. Only lines that can work for
 *  this card: a name the report does not carry gets its page and its name, nothing else. */
export function useCardMenu(): (name: string) => MenuItem[] {
  const { open, known } = useCardDrawer();
  return (name) => {
    const items: MenuItem[] = [];
    if (known.has(name)) {
      items.push({ label: "Read the card", run: () => open(name) });
    }
    items.push({ label: "Open its card page", href: `/cards/${slugOf(name)}` });
    items.push({ label: "Copy the name", run: () => { void navigator.clipboard?.writeText(name).catch(() => {}); } });
    return items;
  };
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
        className={`inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-(--radius) text-base leading-none text-(--muted) hover:bg-(--surface-secondary) hover:text-(--foreground) ${className}`}
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

/** A MENU IN THE WAI PATTERN, at a point on the screen: the first line takes focus, arrows, Home and
 *  End move, Escape or Tab closes and gives focus back, a click outside or a scroll closes. It stays
 *  on screen, flipping to the other side of the point near an edge. `align="end"` puts its right
 *  edge at `x`, as under a button at a row's end. */
export function PopMenu({ x, y, title, items, align = "start", onClose }: {
  x: number; y: number; title: string; items: MenuItem[]; align?: "start" | "end";
  /** `back`: focus should return where the menu came from (a key closed it, or a line was picked). */
  onClose: (back: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const W = window.innerWidth, H = window.innerHeight, w = el.offsetWidth, h = el.offsetHeight;
    let left = align === "end" ? x - w : x;
    if (left + w > W - 8) left = x - w;
    let top = y + h > H - 8 ? y - h - (align === "end" ? 40 : 0) : y;
    left = Math.max(8, Math.min(left, W - w - 8)); top = Math.max(8, top);
    setPos({ left, top });
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [x, y, align]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close.current(false); };
    const gone = () => close.current(false);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("resize", gone);
    };
  }, []);
  const key = (e: React.KeyboardEvent) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (j: number) => { e.preventDefault(); all[(j + all.length) % all.length]?.focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onClose(true); }
  };
  const cls = "flex min-h-10 w-full items-center rounded-[calc(var(--radius)-2px)] px-3 text-left text-sm text-(--foreground) no-underline hover:bg-(--surface-secondary) focus-visible:bg-(--surface-secondary) outline-none";
  return createPortal(
    <div ref={box} role="menu" aria-label={title} onKeyDown={key} onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] flex min-w-56 max-w-[calc(100vw-16px)] flex-col rounded-(--radius) border border-(--separator) bg-(--surface) p-1 shadow-lg"
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}>
      <p aria-hidden="true" className="truncate px-3 pb-1 pt-1.5 text-xs font-semibold text-(--muted)">{title}</p>
      {items.map((it) => it.href ? (
        <a key={it.label} role="menuitem" href={it.href} target="_blank" rel="noopener" className={cls} onClick={() => onClose(false)}>
          {it.label}<span className="ml-auto pl-3 text-(--muted)"><External /></span>
        </a>
      ) : (
        <button key={it.label} type="button" role="menuitem" className={cls} onClick={() => { onClose(true); it.run?.(); }}>{it.label}</button>
      ))}
    </div>,
    document.body,
  );
}
