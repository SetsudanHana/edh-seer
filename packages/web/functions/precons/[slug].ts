import { renderPreconPage } from "../_shared/render-precon.js";

export const onRequestGet: PagesFunction = (context) =>
  renderPreconPage(context.request, context.env.ASSETS, String(context.params.slug));

/** HEAD is the same question as GET, and Pages does not derive one from the other (see
 *  `functions/cards/[slug].ts`). */
export const onRequestHead = onRequestGet;
