import { renderCardPage } from "../_shared/render.js";

export const onRequestGet: PagesFunction = (context) =>
  renderCardPage(context.request, context.env.ASSETS, String(context.params.slug), "card");

/** HEAD IS THE SAME QUESTION AS GET, and Pages does not derive one from the other: a Function that
 *  exports only `onRequestGet` never runs for a HEAD, the request falls through to the asset store,
 *  and every one of these routes -- which are Functions, not files -- answers 404. Measured on the
 *  deployed site 2026-09-08: `GET /cards/nissa-worldsoul-speaker` 200, `HEAD` on the same URL 404,
 *  for all 20,159 card and commander URLs in the sitemap. The runtime drops the body itself, so the
 *  handler is shared rather than reimplemented. */
export const onRequestHead = onRequestGet;
