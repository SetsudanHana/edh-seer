import { useState } from "react";
import { Link } from "react-router";
import { slugOf } from "@edh-seer/matcher/slug";
import { SECTION_MAX, SECTION_SHOWN, type BracketTarget, type UpgradePackage, type UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import type { PreconCard, PreconPage } from "../lib/precon-page.js";
import { afterLine, defaultTarget, GAME_CHANGER, sameAsBelow, SECTION_TITLE, startsAbove, TARGET_MEANING } from "../lib/precon-upgrades.js";
import { cardImageUrl } from "./card-node.js";

/** THE UPGRADE PACKAGES (#767, task 8): one package per bracket target, switched by the bracket the
 *  owner wants to play at, each in role sections of paired swaps with a reason on both sides.
 *
 *  THE BRACKET IS THE QUESTION THE PRECON SEAT CAME WITH ("would I keep up?", baseline 2026-09-30):
 *  the switch says what each bracket allows, and every package is built to keep the deck inside the
 *  one it is for, so the page can say so rather than leave the reader to guess. */
export function UpgradePackages({ page, children }: { page: PreconPage; children?: React.ReactNode }) {
  const first = defaultTarget(page);
  const [target, setTarget] = useState<BracketTarget | null>(first);
  const targets: BracketTarget[] = [2, 3, 4];
  if (first === null && !(page.unreachable ?? []).length) return children ? <>{children}</> : null;
  const pkg = (page.packages ?? []).find((p) => p.target === target) ?? null;
  const cards = page.packageCards ?? {};
  return (
    <section id="upgrades" className="flex scroll-mt-24 flex-col gap-4" aria-labelledby="upgrades-title">
      <span className="eyebrow text-(--muted)">Upgrade it</span>
      <h2 id="upgrades-title" className="text-2xl font-bold">Upgrades for the bracket you play at</h2>
      <div className="flex flex-col gap-2">
        {/* THREE ACROSS ON A PHONE: as a wrapping row, "Bracket 4" fell to a line of its own at 390px. */}
        <div role="group" aria-label="Bracket" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {targets.map((t) => (
            <button key={t} type="button" aria-pressed={t === target} onClick={() => setTarget(t)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border px-3 sm:px-5 font-medium aria-pressed:border-(--accent) aria-pressed:bg-(--accent) aria-pressed:text-(--accent-foreground) border-(--separator) hover:border-(--foreground)">
              Bracket {t}
            </button>
          ))}
        </div>
        {target ? <p className="max-w-[70ch] text-(--muted)">{TARGET_MEANING[target]} {GAME_CHANGER}</p> : null}
      </div>
      {pkg ? <Package pkg={pkg} all={page.packages ?? []} before={page.synergy?.score ?? null} cards={cards} extra={children} /> : target ? (
        <p className="max-w-[70ch]" data-testid="precon-unreachable">
          No swaps bring this deck to bracket {target}: what keeps it above is its commander, or a combo made with its commander, and a commander can&rsquo;t be swapped out.
        </p>
      ) : null}
    </section>
  );
}

function Package({ pkg, all, before, cards, extra }: { pkg: UpgradePackage; all: readonly UpgradePackage[]; before: number | null; cards: Record<string, PreconCard>; extra?: React.ReactNode }) {
  const same = sameAsBelow(pkg, all);
  const sections = [
    ...(pkg.bringDown.length ? [{ id: "bring-down", title: `First, to reach bracket ${pkg.target}`, swaps: pkg.bringDown }] : []),
    ...pkg.sections.filter((s) => s.swaps.length).map((s) => ({ id: s.id, title: SECTION_TITLE[s.id], swaps: s.swaps })),
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="precon-package">
      <p className="max-w-[70ch] text-lg">
        {afterLine(pkg, before)} {startsAbove(pkg)}
        {" "}Each one says why the card goes and why its replacement is better.
      </p>
      {same ? <p className="max-w-[70ch] text-(--muted)" data-testid="precon-same-swaps">{same}</p> : null}
      {/* SECTIONS SIDE BY SIDE AS THE WIDTH ALLOWS: a section is a short column of swaps, and one per
        *  row at 3840 would leave most of the screen empty (#770). */}
      <div className="grid items-start gap-x-8 gap-y-6 min-[100rem]:grid-cols-2 min-[200rem]:grid-cols-3">
        {sections.map((s) => <Section key={s.id} title={s.title} swaps={s.swaps} cards={cards} />)}
        {/* WHAT ELSE THE REPORT FOUND takes a column of the same grid: on a row of its own, a route card
          *  and one line of shortfalls filled a fifth of a 2560 screen (#770 gate, 2026-09-30). */}
        {extra ? <div className="flex flex-col gap-2.5"><h3 className="text-lg font-semibold">Also worth knowing</h3>{extra}</div> : null}
      </div>
    </div>
  );
}

function Section({ title, swaps, cards }: { title: string; swaps: readonly UpgradeSwap[]; cards: Record<string, PreconCard> }) {
  const [open, setOpen] = useState(false);
  const shown = open ? swaps.slice(0, SECTION_MAX) : swaps.slice(0, SECTION_SHOWN);
  const more = Math.min(swaps.length, SECTION_MAX) - SECTION_SHOWN;
  return (
    <div className="flex flex-col gap-2.5" data-testid="precon-section">
      <h3 className="text-lg font-semibold">{title}</h3>
      <ul className="flex flex-col gap-2.5">
        {shown.map((s) => <Swap key={`${s.out.name}>${s.in.name}`} swap={s} card={cards[s.in.name]} />)}
      </ul>
      {more > 0 ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="self-start text-sm text-(--accent) hover:underline">
          {open ? "Show fewer" : `Show ${more} more`}
        </button>
      ) : null}
    </div>
  );
}

function Swap({ swap, card }: { swap: UpgradeSwap; card: PreconCard | undefined }) {
  return (
    <li className="grid gap-x-4 gap-y-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 sm:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] sm:items-start">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="eyebrow text-(--muted)">Take out</span>
        <Link to={`/cards/${slugOf(swap.out.name)}`} className="font-bold hover:text-(--accent)">{swap.out.name}</Link>
        <span className="text-sm text-(--muted)">{beside(swap.out.name, swap.out.reason)}</span>
      </div>
      <span aria-hidden="true" className="text-xl text-(--accent) sm:pt-4">→</span>
      <div className="flex min-w-0 items-start gap-3">
        {card?.art ? <img src={cardImageUrl(card.art) ?? undefined} alt="" width={488} height={680} loading="lazy" className="w-14 shrink-0 rounded-[4.5%/3.3%] shadow-md shadow-black/40" /> : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="eyebrow text-(--accent)">Put in</span>
          <Link to={`/cards/${card?.slug ?? slugOf(swap.in.name)}`} className="font-bold hover:text-(--accent)">{swap.in.name}</Link>
          <span className="text-sm text-(--muted)">{beside(swap.in.name, swap.in.reason)}</span>
        </div>
      </div>
    </li>
  );
}

/** A REASON BESIDE ITS CARD'S NAME drops the name it opens with: "Orzhov Basilica enters tapped."
 *  under "Orzhov Basilica" reads "Enters tapped.". The stored reason keeps it, since the crawler HTML
 *  prints it on its own. */
export function beside(name: string, reason: string): string {
  const front = name.split(" // ")[0]!;
  for (const n of [name, front]) {
    if (reason.startsWith(`${n} `)) {
      // "Path to Exile is the same removal…" beside its name reads "The same removal…".
      const rest = reason.slice(n.length + 1).replace(/^is /, "");
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  return reason;
}
