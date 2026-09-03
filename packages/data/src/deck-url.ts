import { parseMoxfieldId } from "./moxfield.js";
import { parseArchidektId } from "./archidekt.js";

/** Whether the argument is a deck URL on a known host, decided by HOST rather than by substring.
 *
 *  CodeQL js/incomplete-url-substring-sanitization. `input.includes("moxfield.com")` is also true
 *  of `https://moxfield.com.example.invalid/x` and of `https://evil/?q=moxfield.com`, so the
 *  substring test does not establish that the host is Moxfield. It decides which branch runs --
 *  fetch a remote deck, or read a LOCAL FILE -- so getting it wrong routes one into the other.
 *
 *  A non-URL argument (the normal case: a path to a decklist) throws inside `URL` and is correctly
 *  reported as "not a Moxfield URL", which sends it down the file branch where it belongs. */
function hostOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHost(input: string, domain: string): boolean {
  const host = hostOf(input);
  return host !== null && (host === domain || host.endsWith(`.${domain}`));
}

export function isMoxfieldUrl(input: string): boolean {
  return isHost(input, "moxfield.com");
}

export function isArchidektUrl(input: string): boolean {
  return isHost(input, "archidekt.com");
}


/** The deck site and id a link points at, or null when it is not one of ours.
 *
 *  ONE PLACE, TWO CALLERS. The CLI uses it to choose between a fetch and reading a local file; the
 *  browser uses it to choose between importing and analysing a paste. A host check that decides which
 *  branch runs is exactly the kind that must not exist twice -- CodeQL caught the substring version of
 *  the Moxfield one already (`js/incomplete-url-substring-sanitization`). */
export function deckSourceOf(input: string): { source: "moxfield" | "archidekt"; id: string } | null {
  const trimmed = input.trim();
  if (isMoxfieldUrl(trimmed)) {
    const id = parseMoxfieldId(trimmed);
    return id ? { source: "moxfield", id } : null;
  }
  if (isArchidektUrl(trimmed)) {
    const id = parseArchidektId(trimmed);
    return id ? { source: "archidekt", id } : null;
  }
  return null;
}
