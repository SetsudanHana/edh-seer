import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { slugOf as slugOfName } from "@edh-seer/matcher/slug";
import { analyzeDeckStatic } from "../api.static.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { buildOrbit, countText } from "../lib/orbit-model.js";
import { identityLabel } from "../lib/color-identity.js";
import { year } from "../lib/precon-html.js";
import { loadPrecon, preconDecklist, type PreconRecord } from "../lib/precons.js";
import type { PreconPage as Page } from "../lib/precon-page.js";
import type { AnalyzeResponse } from "../types.js";
import { cardImageUrl } from "./card-node.js";
import { CardDrawerProvider, useCardDrawer } from "./card-drawer.js";
import { allPartners, Constellation } from "./Constellation.js";
import { useNarrow } from "./engine-parts.js";
import { useIsNarrow } from "../lib/use-narrow.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { MapKey } from "./MapKey.js";
import { UpgradePackages } from "./UpgradePackages.js";
import { defaultTarget, swapsOf } from "../lib/precon-upgrades.js";

import { Arrow, Chevron } from "./icons.js";
/** `/precons/:slug` (Precon mockup, 2026-09-27): the precon's theme and scores beside its
 *  commander's map, then its upgrade packages by bracket (#767), then the list. The page
 *  is the file `build-precons` wrote; only the map is drawn live, from the list, once the page is up. */
export function PreconPage() {
  const { slug = "" } = useParams();
  const [rec, setRec] = useState<PreconRecord | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRec(undefined);
    void loadPrecon(slug).then((r) => { if (live) setRec(r); });
    return () => { live = false; };
  }, [slug]);
  if (rec === undefined) return <p className="py-10 text-(--muted)" role="status">Loading the precon</p>;
  if (rec === null) {
    return (
      <div className="flex flex-col gap-3 py-10">
        <h1 className="text-2xl font-bold">No precon page here</h1>
        <p className="text-(--muted)">No Commander precon goes by that name. <Link className="text-(--accent) underline" to="/precons">Every precon we read</Link>.</p>
      </div>
    );
  }
  return <PreconView page={rec.page} siblings={rec.siblings} />;
}

function PreconView({ page: p, siblings }: { page: Page; siblings: PreconRecord["siblings"] }) {
  const opening = defaultTarget(p);
  const upgrades = opening ? swapsOf(p.packages!.find((k) => k.target === opening)!).length : 0;
  const pip = p.identity.map((c) => `{${c}}`).join("");
  return (
    <div className="flex flex-col gap-12 py-6" data-testid="precon-page">
      {/* THE MAP TAKES THE ROW (designer review 2026-09-30, #770): capped at 30rem it was a 480x393
        *  picture in the top-right corner of a 2560 screen with ~1,500px of nothing between it and
        *  the header. The header keeps its measure; the map has the rest, 16:9 from 1600px, held to
        *  the screen's height so the swaps still start on the first screen. */}
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <nav aria-label="Breadcrumb" className="text-sm text-(--muted)"><Link to="/precons" className="hover:text-(--foreground)">Precons</Link> <Chevron dir="right" /> {p.setName}</nav>
          <span className="eyebrow text-(--muted)">Commander precon · {p.setName}{p.releaseDate ? ` · ${year(p.releaseDate)}` : ""}</span>
          <h1 className="text-4xl font-bold leading-tight tracking-[-0.02em]">{p.name}</h1>
          <p className="text-(--muted)">
            {p.commanders.map((c, i) => <span key={c}>{i > 0 ? " and " : ""}<Link className="hover:text-(--foreground)" to={`/commanders/${slugOfName(c)}`}>{c}</Link></span>)}
            {pip ? <> · <span aria-hidden="true" className="inline-flex align-[-0.15em]"><ManaSymbols cost={pip} /></span> {identityLabel(p.identity)}</> : null}
          </p>
          {/* THREE ACROSS ON A PHONE TOO (designer review 2026-09-30): at 8rem each the tiles wrapped
            *  two and one, leaving "Bracket" alone on its row. */}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap" data-testid="precon-facts">
            {p.theme ? <Fact label="Main theme" value={p.theme} /> : null}
            {p.synergy ? <Fact label="Synergy" value={<>{p.synergy.score.toFixed(1)}<span className="text-sm text-(--muted)">/5</span></>} note={p.synergy.band.toLowerCase()} /> : null}
            {p.bracket ? <Fact label="Bracket" value={p.bracket.band.replace("-", "–")} note={p.bracket.gameChangers ? `${p.bracket.gameChangers} Game Changer${p.bracket.gameChangers === 1 ? "" : "s"}` : "no Game Changers"} /> : null}
          </div>
          <p className="max-w-[60ch] text-lg">
            {/* SAID AS WHAT IT IS: an engine that reads no link is not a deck with none (Yidris, Zedruu). */}
            {p.commanderLinks > 0 ? `${p.commanders[0]} works with ${p.commanderLinks} of its cards.` : `No card in it links to ${p.commanders[0]} in a way the engine reads yet.`}
            {upgrades ? ` ${spell(upgrades)} swaps below upgrade it, at the bracket you play at.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {upgrades ? <a href="#upgrades" className="btn-primary gap-1.5">See the upgrades <Arrow dir="down" /></a> : null}
            {p.report ? <a href={p.report} className="btn-secondary">Open the full report</a> : null}
          </div>
        </div>
        <div className="min-w-0 w-full justify-self-center lg:max-w-[calc(55svh*1.2222)] min-[100rem]:max-w-[calc(55svh*1.7778)]">
          <PreconMap page={p} />
        </div>
      </section>

      <UpgradePackages page={p}>
        {p.route || p.gaps.length ? (
          <>
            {p.route ? (
              <div className="flex items-center gap-3 rounded-(--radius) border border-dashed border-(--accent) p-3">
                {p.route.art ? <img src={cardImageUrl(p.route.art) ?? undefined} alt="" width={488} height={680} loading="lazy" className="w-14 shrink-0 rounded-[4.5%/3.3%]" /> : null}
                <div className="flex flex-col"><span className="eyebrow text-(--accent)">Opens a route</span><Link to={`/cards/${p.route.slug}`} className="font-bold hover:text-(--accent)">{p.route.name}</Link><span className="text-sm text-(--muted)">{p.route.reach} of its cards reach {p.route.to} through it.</span></div>
              </div>
            ) : null}
            {p.gaps.length ? (
              <p className="text-sm text-(--muted)">
                {p.gaps.map((g, i) => <span key={g.group}>{i === 0 ? "" : i === p.gaps.length - 1 ? " and " : ", "}<b className="text-(--foreground)">{g.target - g.have} short on {g.group.toLowerCase()}</b></span>)}, against a typical Commander deck.
                {p.report ? <> The <a href={p.report} className="text-(--accent) underline underline-offset-2">full report</a> lists cards for {p.gaps.length === 1 ? "it" : p.gaps.length === 2 ? "both" : "each"}.</> : null}
              </p>
            ) : null}
          </>
        ) : null}
      </UpgradePackages>

      <section className="flex flex-col gap-1" aria-labelledby="list-title">
        <span className="eyebrow text-(--muted)">The decklist</span>
        <h2 id="list-title" className="mb-2 text-2xl font-bold">What&rsquo;s in the box</h2>
        {/* THE TYPES SIDE BY SIDE AND THE NAMES IN COLUMNS (designer review 2026-09-30, #770): each
          *  type was one running line of names, 3,600px long at 3840. */}
        <div className="grid items-start gap-x-8 min-[100rem]:grid-cols-2 min-[200rem]:grid-cols-4">
        {p.decklist.map((g) => (
          <div key={g.group} className="flex flex-col gap-2 border-t border-(--separator) py-3">
            <h3 className="text-sm font-semibold">{g.group} · {g.cards.reduce((t, c) => t + c.count, 0)}</h3>
            <ul className="columns-2 sm:columns-[11rem] gap-x-6 text-sm">{g.cards.map((c) => <li key={c.name} className="break-inside-avoid py-0.5">{c.count > 1 ? `${c.count} ` : ""}<Link to={`/cards/${slugOfName(c.name)}`} className="hover:text-(--accent)">{c.name}</Link></li>)}</ul>
          </div>
        ))}
        </div>
      </section>

      {siblings.length ? (
        <section className="flex flex-col gap-2">
          <span className="eyebrow text-(--muted)">Same set</span>
          <h2 className="text-xl font-bold">Other {p.setName} precons</h2>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => <Link key={s.slug} to={`/precons/${s.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-(--separator) px-4 text-sm hover:border-(--foreground)">{s.name}</Link>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex min-w-0 sm:min-w-32 flex-col gap-0.5 rounded-(--radius) border border-(--separator) bg-(--surface) px-3 py-2">
      <span className="eyebrow text-(--muted)">{label}</span>
      <b className="text-xl">{value}</b>
      {note ? <span className="text-xs text-(--muted)">{note}</span> : null}
    </div>
  );
}

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];
const spell = (n: number) => WORDS[n] ?? String(n);

/** THE COMMANDER'S MAP, DRAWN FROM THE LIST ONCE THE PAGE IS UP: the page itself is precomputed, the
 *  map needs the engine's links, so it runs the analysis the report runs and draws what the Glance
 *  map draws. Until then, and on failure, the space says so rather than jumping. */
function PreconMap({ page }: { page: Page }) {
  const [data, setData] = useState<AnalyzeResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    analyzeDeckStatic(preconDecklist(page), page.commanders.join("\n"), "/static")
      .then((d) => { if (live) setData(d); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [page]);
  if (!data?.graph) {
    return <div className="flex aspect-[880/720] min-[100rem]:aspect-[16/9] w-full items-center justify-center rounded-(--radius) text-sm text-(--muted)">{data === null ? "" : "Drawing the commander's map"}</div>;
  }
  return (
    <CardDrawerProvider graph={data.graph}>
      <MapOf data={data} commanders={page.commanders} />
    </CardDrawerProvider>
  );
}

function MapOf({ data, commanders }: { data: AnalyzeResponse; commanders: string[] }) {
  const drawer = useCardDrawer();
  const narrow = useNarrow();
  const broad = !useIsNarrow(1599);
  const [lit, setLit] = useState<string | null>(null);
  const model = useMemo(() => buildEngineModel(data.report, data.graph!), [data]);
  const wanted = new Set(commanders.flatMap((c) => [c, c.split(" // ")[0]!]));
  const id = data.graph!.nodes.find((n) => !n.face && !n.isToken && (wanted.has(n.cardName ?? n.label) || wanted.has(n.label)))?.id;
  const orbit = useMemo(() => (id ? buildOrbit(model, id) : null), [model, id]);
  if (!orbit) return null;
  const first = commanders[0]!.split(",")[0]!.split(" // ")[0]!;
  return (
    <div className="flex flex-col gap-2">
      <Constellation model={model} orbit={orbit} trail={[]} lit={lit} still={false} narrow={narrow} broad={broad} pick={allPartners}
        onTap={(t) => { const c = model.cards.get(t); if (c && !c.isToken) drawer.open(drawer.known.has(c.name) ? c.name : c.physical); setLit(t); }}
        onHover={setLit} onBlank={() => setLit(null)} />
      {/* THE KEY THE REPORT'S MAP HAS (#890, #993): the same map drawn here had no key at all. */}
      <MapKey columns rows={orbit.sectors.map((x) => ({
        key: x.name, name: x.name, hue: x.hue,
        count: countText(x.partners.length, x.partners.filter((p) => p.once).length, first),
      }))} />
    </div>
  );
}
