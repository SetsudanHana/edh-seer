import { renderBrowseIndex } from "../_shared/render-browse.js";

export const onRequestGet: PagesFunction = (context) =>
  renderBrowseIndex(context.request, context.env.ASSETS, "cards");

/** HEAD runs the same handler -- see `functions/cards/[slug].ts` for why it has to be said. */
export const onRequestHead = onRequestGet;
