import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useInRouterContext } from "react-router";
import { slugOf } from "@edh-seer/matcher/slug";
import { Arrow } from "./icons.js";

/** ONE MENU FOR A CARD, WHEREVER THE CARD IS (owner, 2026-09-27: the map's right-click menu, then
 *  "add the ⋯ menu to the other card lists too"; 2026-10-03: "I would have it consistent"). The
 *  same lines behind the ⋯ button, a right-click and a long press, on a map and on every list:
 *  read the card, open its page, copy its name. */

/** One line of a menu: an action, or a link to a page on this site. It opens in the same tab, as
 *  every "open card" does (#1003); a middle or modifier click still opens a new one. */
export interface MenuItem { label: string; run?: () => void; href?: string }

/** The lines for one card. `read` is absent where nothing on this page can show the card. */
export function cardLines(name: string, read?: () => void, slug = slugOf(name)): MenuItem[] {
  return [
    ...(read ? [{ label: "Read the card", run: read }] : []),
    { label: "Open its card page", href: `/cards/${slug}` },
    { label: "Copy the name", run: () => { void navigator.clipboard?.writeText(name).catch(() => {}); } },
  ];
}

/** RIGHT-CLICK OR LONG-PRESS ON ANY CARD (owner, 2026-10-03). Mounted once, under the router. A
 *  surface opts in by putting `data-card="<name>"` (and `data-card-slug` where the slug is not
 *  the name's) on the element whose plain click opens the card panel, so "Read the card" IS that
 *  click and cannot drift from what the surface does. A map draws its own menu and stops the event. */
export function CardContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; el: HTMLElement } | null>(null);
  useEffect(() => {
    const cardAt = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-card]") : null);
    let press = { timer: 0, x: 0, y: 0, fired: false };
    const cancel = () => { window.clearTimeout(press.timer); press.timer = 0; };
    const context = (e: MouseEvent) => {
      const el = cardAt(e.target);
      if (!el || e.defaultPrevented) return;
      e.preventDefault();
      // A long press already opened it; the browser's own contextmenu after it would open it twice.
      if (press.fired) return;
      const r = el.getBoundingClientRect();
      setMenu({ x: e.clientX || r.left + r.width * 0.75, y: e.clientY || r.top + r.height * 0.75, el });
    };
    const down = (e: PointerEvent) => {
      cancel();
      press.fired = false;
      const el = e.pointerType === "touch" ? cardAt(e.target) : null;
      if (!el) return;
      press = { timer: window.setTimeout(() => { press.fired = true; setMenu({ x: e.clientX, y: e.clientY, el }); }, 520), x: e.clientX, y: e.clientY, fired: false };
    };
    const move = (e: PointerEvent) => { if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancel(); };
    // The lift after a long press is not a tap: it would open the panel, or pick the line under the finger.
    const click = (e: MouseEvent) => { if (press.fired && e.isTrusted) { press.fired = false; e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener("contextmenu", context);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    window.addEventListener("click", click, true);
    return () => {
      cancel();
      document.removeEventListener("contextmenu", context);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", cancel, true);
      document.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("click", click, true);
    };
  }, []);
  if (!menu) return null;
  const { el } = menu;
  const name = el.dataset.card!;
  return (
    <PopMenu x={menu.x} y={menu.y} title={name}
      items={cardLines(name, () => { if (el.isConnected) el.click(); }, el.dataset.cardSlug || undefined)}
      onClose={(back) => { setMenu(null); if (back && el.isConnected) el.focus({ preventScroll: true }); }} />
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
  }, [x, y, align]);
  // FOCUS ONCE IT IS SHOWN (#1003 review): focused in the measuring pass above, the menu was still
  // `visibility: hidden`, the browser refused the focus, and Escape had nothing to land on.
  useEffect(() => {
    if (pos) box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [pos]);
  useEffect(() => {
    // Escape closes from the document, so it works wherever focus happens to be.
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(true); } };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close.current(false); };
    const gone = () => close.current(false);
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc, true);
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
    else if (e.key === "Tab") { e.preventDefault(); onClose(true); }
  };
  const routed = useInRouterContext();
  const cls = "flex min-h-11 w-full items-center rounded-[calc(var(--radius)-2px)] px-3 text-left text-sm text-(--foreground) no-underline hover:bg-(--surface-secondary) focus-visible:bg-(--surface-secondary) outline-none";
  return createPortal(
    <div ref={box} role="menu" aria-label={title} onKeyDown={key} onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] flex min-w-56 max-w-[calc(100vw-16px)] flex-col rounded-(--radius) border border-(--separator) bg-(--surface) p-1"
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}>
      <p aria-hidden="true" className="truncate px-3 pb-1 pt-1.5 text-xs font-semibold text-(--muted)">{title}</p>
      {items.map((it) => it.href ? (
        routed
          ? <Link key={it.label} role="menuitem" to={it.href} className={cls} onClick={() => onClose(false)}>{it.label}<span className="ml-auto pl-3 text-(--muted)"><Arrow dir="right" /></span></Link>
          : <a key={it.label} role="menuitem" href={it.href} className={cls} onClick={() => onClose(false)}>{it.label}<span className="ml-auto pl-3 text-(--muted)"><Arrow dir="right" /></span></a>
      ) : (
        <button key={it.label} type="button" role="menuitem" className={cls} onClick={() => { onClose(true); it.run?.(); }}>{it.label}</button>
      ))}
    </div>,
    document.body,
  );
}
