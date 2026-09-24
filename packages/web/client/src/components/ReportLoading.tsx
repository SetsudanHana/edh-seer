/** WHAT THE PAGE SHOWS WHILE A DECK IS BEING READ (look-and-feel review, 2026-09-24).
 *
 *  Before this, pressing Analyse left the collapsed deck bar over an empty page for the 6-9 s the
 *  live site takes to fetch ~96 card shards and run the analysis, and every one of four player
 *  reviewers read that as a crash: "It looked broken." The only sign of life was the button label.
 *
 *  THE SHAPE OF THE REPORT, NOT A SPINNER. A skeleton in the report's own layout -- the summary strip,
 *  two gauges, the chapter rail -- says what is coming and where, and it occupies the space the
 *  report will, so nothing jumps when it arrives. The one sentence is a live region, so a screen
 *  reader hears that work has started rather than silence.
 *
 *  NO FAKE PROGRESS. The analysis does not report stages, so this does not invent them. */
export function ReportLoading({ commander, lines }: { commander?: string; lines?: number }) {
  const bar = "rounded-(--radius) bg-(--surface-tertiary) motion-safe:animate-pulse";
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" aria-live="polite" className="text-sm text-(--muted)">
        {lines && lines > 0 ? `Reading ${lines} lines` : "Reading your deck"}
        {commander ? ` for ${commander}` : ""}. This usually takes a few seconds.
      </p>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-4 pb-4 border-b border-(--separator)">
          <span className={`${bar} h-5 w-48`} />
          <span className={`${bar} h-4 w-24`} />
          <span className={`${bar} h-4 w-24`} />
        </div>
        <div className="flex gap-8">
          <div className="hidden lg:flex flex-col gap-3 w-24 shrink-0">
            {Array.from({ length: 6 }, (_, i) => <span key={i} className={`${bar} h-3 w-16`} />)}
          </div>
          <div className="flex flex-col gap-5 flex-1 min-w-0">
            <span className={`${bar} h-8 w-64 max-w-full`} />
            <span className={`${bar} h-4 w-96 max-w-full`} />
            <div className="flex flex-wrap gap-6">
              <span className={`${bar} h-40 w-40 rounded-full`} />
              <span className={`${bar} h-40 w-40 rounded-full`} />
            </div>
            <span className={`${bar} h-4 w-full max-w-xl`} />
            <span className={`${bar} h-4 w-full max-w-lg`} />
          </div>
        </div>
      </div>
    </div>
  );
}
