import { renderCardPage } from "../_shared/render.js";

export const onRequestGet: PagesFunction = (context) =>
  renderCardPage(context.request, context.env.ASSETS, String(context.params.slug), "commander");
