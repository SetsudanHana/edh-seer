import { forwardRef } from "react";
import { Link, useInRouterContext } from "react-router";
import { Arrow } from "./icons.js";

/** THE CARD PANEL'S ONE BAR (#1003, owner 2026-10-03). "Look at a card" was three panels -- the
 *  report's drawer, the suggestion panel and the peek -- and each had its own way out: an 11px
 *  "CLOSE" eyebrow (a 38x16px target on a phone), a 44px pill, a link at the foot. Every panel now
 *  opens on this bar: Back when there is somewhere to go back to, Open card when the card has a
 *  page, Close. The pills are the site's action family, 44px.
 *
 *  `back.closes` is the docked report rail's case: its "Back to Game plan" IS the way out, so a
 *  second Close beside it would be two buttons for one act. */
export const PanelBar = forwardRef<HTMLButtonElement, {
  back?: { label: string; run: () => void; closes?: boolean };
  open?: { to: string; label: string; name: string; onGo?: () => void };
  onClose: () => void;
}>(function PanelBar({ back, open, onClose }, closeRef) {
  // A plain link where no router is mounted (a panel rendered on its own); the app always has one.
  const routed = useInRouterContext();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="panel-bar">
      {back ? (
        <button type="button" className="btn-secondary gap-1.5" onClick={back.run} ref={back.closes ? closeRef : undefined}>
          <Arrow dir="left" /> {back.label}
        </button>
      ) : null}
      {open ? (
        routed
          ? <Link className="btn-primary whitespace-nowrap" to={open.to} aria-label={`Open ${open.name}`} onClick={open.onGo}>{open.label}</Link>
          : <a className="btn-primary whitespace-nowrap" href={open.to} aria-label={`Open ${open.name}`}>{open.label}</a>
      ) : null}
      {back?.closes ? null : (
        <button ref={closeRef} type="button" className="btn-secondary ml-auto" onClick={onClose}>Close</button>
      )}
    </div>
  );
});
