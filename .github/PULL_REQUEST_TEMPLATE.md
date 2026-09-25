## What changed

<!-- One or two sentences. What does this do that the previous behaviour did not? -->

## What it was measured against

<!-- This project records the measured effect of every change beside the change.

     The instruments are free to run and need no model, but they read the MongoDB corpus, and
     panel-score also needs the judged panel, which is local to the maintainer's checkout. If you
     could not run them, say so and the maintainer will:
       npx tsx packages/instruments/src/panel-score.ts          precision AND retention
       npx tsx packages/instruments/src/population-compare.ts   edges and reasons, before/after
       npx tsx packages/instruments/src/eval-pairs.ts           the compass

     Quote the panel's precision WITH its retention figure — precision alone is not comparable
     across any change that shrinks the claim set.

     A change with no measurable effect is a fine answer. Say so explicitly and say why; a silent
     one is what this section exists to prevent. -->

## Checklist

- [ ] `npm test` passes, and the final "Tests N passed" count is in the PR body
- [ ] `npm run typecheck` passes — vitest does not typecheck
- [ ] `npm run lint:bins` passes, if a script was added or moved
- [ ] `npm run tokens:check` passes, if `tokens/` or UI CSS changed
- [ ] `docs/reference/SCHEMA.md` regenerated, if the schema or a vocabulary changed
- [ ] Screenshots regenerated (`npm run screenshots -w @edh-seer/web`), if the graph, game plan, suggestions or mana chart look different
