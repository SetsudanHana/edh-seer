import { Fragment } from "react";
import { Link } from "react-router";
import { Chevron } from "./icons.js";

/** THE WAY BACK UP, ONE PATTERN ON EVERY DETAIL PAGE (designer crawl 2026-10-03, #994 item 12).
 *  The precon page had "Precons › set" in Inter 14 muted; the card and commander pages had none.
 *  Links for every step but the last, which says where the reader is. */
export function Breadcrumb({ steps }: { steps: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-1.5 text-sm text-(--muted)">
      {steps.map((s, i) => (
        <Fragment key={i}>
          {i > 0 ? <Chevron dir="right" /> : null}
          {s.to ? <Link to={s.to} className="hover:text-(--foreground)">{s.label}</Link> : <span aria-current="page">{s.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}
