import { expect, test } from "vitest";
import { toHtml } from "./graph-html.js";
import type { CardGraph } from "./graph.js";

const g: CardGraph = {
  nodes: [
    { id: "card:a", kind: "card", label: "Krenko, Mob Boss" },
    { id: "subtype:goblin", kind: "subtype", label: "goblin" },
  ],
  edges: [{ from: "card:a", to: "subtype:goblin", kind: "SUBTYPE" }],
};

test("embeds the graph and renders a self-contained page", () => {
  const html = toHtml(g, "deck.txt");
  expect(html).toContain("<canvas");
  expect(html).toContain("Krenko, Mob Boss");
  // Self-contained: nothing to fetch, so it works offline and from a file:// URL.
  expect(html).not.toMatch(/src\s*=\s*["']http/);
});

/** The graph payload is embedded in an inline <script>, so a label containing a closing script tag
 *  would break out of it. No real card name does; the corpus is data, and the escape is free. */
test("a label containing a script tag cannot close the inline script", () => {
  const nasty: CardGraph = {
    nodes: [{ id: "card:x", kind: "card", label: "</script><img onerror=alert(1)>" }],
    edges: [],
  };
  const html = toHtml(nasty, "t");
  expect(html.match(/<\/script>/g)).toHaveLength(1); // only the page's own closing tag
  expect(html).toContain("\\u003c/script>");
});

test("the title is HTML-escaped", () => {
  const html = toHtml(g, '"><script>alert(1)</script>');
  expect(html).not.toContain("<script>alert(1)");
  expect(html).toContain("&quot;&gt;&lt;script&gt;");
});
