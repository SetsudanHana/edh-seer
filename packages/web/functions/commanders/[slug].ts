import { renderCardPage } from "../_shared/render.js";

export const onRequestGet: PagesFunction = (context) =>
  renderCardPage(context.request, context.env.ASSETS, String(context.params.slug), "commander");

/** HEAD runs the same handler -- see `functions/cards/[slug].ts` for why it has to be said twice. */
export const onRequestHead = onRequestGet;
