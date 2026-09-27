import { renderPreconIndex } from "../_shared/render-precon.js";

export const onRequestGet: PagesFunction = (context) => renderPreconIndex(context.request, context.env.ASSETS);

/** HEAD is the same question as GET (see `functions/cards/[slug].ts`). */
export const onRequestHead = onRequestGet;
