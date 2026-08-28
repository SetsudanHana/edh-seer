/** Whether the argument is a Moxfield deck URL, decided by HOST rather than by substring.
 *
 *  CodeQL js/incomplete-url-substring-sanitization. `input.includes("moxfield.com")` is also true
 *  of `https://moxfield.com.example.invalid/x` and of `https://evil/?q=moxfield.com`, so the
 *  substring test does not establish that the host is Moxfield. It decides which branch runs --
 *  fetch a remote deck, or read a LOCAL FILE -- so getting it wrong routes one into the other.
 *
 *  A non-URL argument (the normal case: a path to a decklist) throws inside `URL` and is correctly
 *  reported as "not a Moxfield URL", which sends it down the file branch where it belongs. */
export function isMoxfieldUrl(input: string): boolean {
  let host: string;
  try {
    host = new URL(input).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "moxfield.com" || host.endsWith(".moxfield.com");
}

