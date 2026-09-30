import { slugOf } from "@edh-seer/matcher/slug";
import type { PreconPage } from "./precon-page.js";
import { afterLine, GAME_CHANGER, sameAsBelow, SECTION_TITLE, startsAbove, TARGET_MEANING } from "./precon-upgrades.js";

/** THE PRECON PAGES AS A CRAWLER READS THEM (and a reader, for the moment before the app boots):
 *  the same facts the React page draws, as plain HTML inside `.prerendered`, which the app hides
 *  once it runs. Card names and the engine's own sentences only, as on every served page. */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The index row a page links to its set-mates with. */
export type PreconIndexEntry = Pick<PreconPage, "slug" | "name" | "setCode" | "setName" | "releaseDate" | "commanders" | "identity" | "theme">;

/** `data-slug` for a precon's inline record: prefixed, so a card page's reader can never take it. */
export const preconDataSlug = (slug: string): string => `precon:${slug}`;

export const year = (d: string | null): string => (d ? d.slice(0, 4) : "");

/** "Party Time: Commander precon, Nalia de'Arnise — synergy upgrades" style title and summary. */
export function preconTitle(p: Pick<PreconPage, "name" | "setName">): string {
  return `${p.name} precon upgrades — ${p.setName} — EDH Seer`;
}
export function preconDescription(p: PreconPage): string {
  const lead = p.commanders.join(" and ");
  const n = (p.packages ?? []).length;
  const swaps = n ? ` Upgrades for bracket ${(p.packages ?? []).map((k) => k.target).join(", ")}, each swap with its reasons written out.` : "";
  return `${p.name}, the ${p.setName} Commander precon led by ${lead}${p.theme ? `: ${p.theme}` : ""}.${swaps}`;
}

export function preconPageHtml(p: PreconPage, siblings: readonly PreconIndexEntry[]): string {
  const lines: string[] = [];
  lines.push(`    <section class="prerendered">`);
  lines.push(`    <p><a href="/precons">Precons</a> › ${esc(p.setName)}</p>`);
  lines.push(`    <h1>${esc(p.name)}</h1>`);
  lines.push(`    <p>Commander precon · ${esc(p.setName)}${p.releaseDate ? ` · ${esc(year(p.releaseDate))}` : ""} · led by ${p.commanders.map((c) => `<a href="/commanders/${esc(slugOf(c))}">${esc(c)}</a>`).join(" and ")}</p>`);
  const facts = [
    p.theme ? `Main theme: ${esc(p.theme)}` : "",
    p.synergy ? `Synergy ${p.synergy.score.toFixed(1)}/5 (${esc(p.synergy.band.toLowerCase())})` : "",
    p.bracket ? `Bracket ${esc(p.bracket.band.replace("-", "–"))}` : "",
    p.commanderLinks ? `${p.commanders[0] ? esc(p.commanders[0]) : "The commander"} works with ${p.commanderLinks} of its cards` : "",
  ].filter(Boolean);
  if (facts.length) lines.push(`    <p>${facts.join(" · ")}</p>`);
  for (const k of p.packages ?? []) {
    lines.push(`    <h2>Upgrades at bracket ${k.target}</h2>`);
    lines.push(`    <p>${esc(TARGET_MEANING[k.target])} ${k.target === 2 ? esc(GAME_CHANGER) : ""}${esc(startsAbove(k))}</p>`.replace(" </p>", "</p>"));
    lines.push(`    <p>${esc(afterLine(k, p.synergy?.score ?? null))}${sameAsBelow(k, p.packages ?? []) ? ` ${esc(sameAsBelow(k, p.packages ?? []))}` : ""}</p>`);
    const groups = [
      ...(k.bringDown.length ? [{ title: `First, to reach bracket ${k.target}`, swaps: k.bringDown }] : []),
      ...k.sections.filter((x) => x.swaps.length).map((x) => ({ title: SECTION_TITLE[x.id], swaps: x.swaps })),
    ];
    for (const g of groups) {
      lines.push(`    <h3>${esc(g.title)}</h3>`);
      lines.push(`    <ol>`);
      for (const w of g.swaps) {
        const slug = p.packageCards?.[w.in.name]?.slug ?? slugOf(w.in.name);
        lines.push(`      <li>Take out ${esc(w.out.name)}: ${esc(w.out.reason)} Put in <a href="/cards/${esc(slug)}">${esc(w.in.name)}</a>: ${esc(w.in.reason)}</li>`);
      }
      lines.push(`    </ol>`);
    }
  }
  for (const t of p.unreachable ?? []) lines.push(`    <p>No swaps bring this deck to bracket ${t}: what keeps it above is its commander, or a combo made with its commander.</p>`);
  if (p.route) lines.push(`    <p>Opens a route: <a href="/cards/${esc(p.route.slug)}">${esc(p.route.name)}</a>. ${p.route.reach} of its cards reach ${esc(p.route.to)} through it.</p>`);
  if (p.gaps.length) lines.push(`    <p>Also short, against a typical Commander deck: ${p.gaps.map((g) => `${esc(g.group.toLowerCase())} ${g.have} of ${g.target}`).join(", ")}.</p>`);
  lines.push(`    <h2>The decklist</h2>`);
  for (const g of p.decklist) {
    lines.push(`    <h3>${esc(g.group)}</h3>`);
    lines.push(`    <p>${g.cards.map((c) => `${c.count > 1 ? `${c.count} ` : ""}${esc(c.name)}`).join(" · ")}</p>`);
  }
  const mates = siblings.filter((s) => s.setCode === p.setCode && s.slug !== p.slug);
  if (mates.length) {
    lines.push(`    <h2>Other ${esc(p.setName)} precons</h2>`);
    lines.push(`    <ul>${mates.map((s) => `<li><a href="/precons/${esc(s.slug)}">${esc(s.name)}</a></li>`).join("")}</ul>`);
  }
  lines.push(`    </section>`);
  return lines.join("\n");
}

/** Sets newest first, each with its precons by name. */
export function preconSets(list: readonly PreconIndexEntry[]): { setCode: string; setName: string; releaseDate: string | null; decks: PreconIndexEntry[] }[] {
  const sets = new Map<string, { setCode: string; setName: string; releaseDate: string | null; decks: PreconIndexEntry[] }>();
  for (const e of list) {
    const s = sets.get(e.setCode) ?? { setCode: e.setCode, setName: e.setName, releaseDate: e.releaseDate, decks: [] };
    s.decks.push(e);
    if ((e.releaseDate ?? "") > (s.releaseDate ?? "")) s.releaseDate = e.releaseDate;
    sets.set(e.setCode, s);
  }
  return [...sets.values()]
    .map((s) => ({ ...s, decks: [...s.decks].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.setName.localeCompare(b.setName));
}

export function preconIndexHtml(list: readonly PreconIndexEntry[]): string {
  const lines = [`    <section class="prerendered">`, `    <h1>Commander precons</h1>`,
    `    <p>Every Commander precon, read card by card: its theme, how well its cards work together, and the swaps that make them work together more.</p>`];
  for (const s of preconSets(list)) {
    lines.push(`    <h2>${esc(s.setName)}${s.releaseDate ? ` (${esc(year(s.releaseDate))})` : ""}</h2>`);
    lines.push(`    <ul>${s.decks.map((d) => `<li><a href="/precons/${esc(d.slug)}">${esc(d.name)}</a> — ${esc(d.commanders.join(" and "))}${d.theme ? `, ${esc(d.theme)}` : ""}</li>`).join("")}</ul>`);
  }
  lines.push(`    </section>`);
  return lines.join("\n");
}
