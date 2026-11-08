/** The text with every parenthesised span (reminder text, nested ones too) replaced by one space, read by a single linear character pass (#1568). A regex such as /\([^)]*\)/g backtracks polynomially on a text with many "(" and no ")"
 *  (CodeQL js/polynomial-redos), and the two readers of card text that strip reminders (`kindsIn`, `printedTextNamesCreatureType`) are exported. An unmatched ")" is kept as it is; an unclosed "(" drops the rest of the text.
 *  Newlines inside a span go with it; callers that must keep a line's reminder apart from the next line's call this per line. */
export function withoutParentheses(text: string): string {
  let out = "";
  let depth = 0;
  for (const c of text) {
    if (c === "(") depth++;
    if (depth === 0) out += c;
    else if (c === ")") { depth--; if (depth === 0) out += " "; }
  }
  return out;
}
