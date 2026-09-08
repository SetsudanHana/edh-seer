import { renderBrowseLetter } from "../../_shared/render-browse.js";

export const onRequestGet: PagesFunction = (context) =>
  renderBrowseLetter(context.request, context.env.ASSETS, "cards", String(context.params.letter));

/** HEAD runs the same handler -- see `functions/cards/[slug].ts` for why it has to be said. */
export const onRequestHead = onRequestGet;
