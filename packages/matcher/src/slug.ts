/* A LEAF: imports nothing, so any bundle can take the slug rule without taking the partner engine. */

/** A CARD NAME BECOMES A URL.
 *
 *  Diacritics are FOLDED rather than dropped: NFD splits a letter from its combining mark and the
 *  mark alone is removed, so `Jötun Grunt` reads `jotun-grunt` and not `jtun-grunt`. `Æ` is not a
 *  letter-plus-mark and NFD does not touch it, so it is mapped explicitly -- it appears in real card
 *  names (`Æther Vial`) and would otherwise vanish into a hyphen.
 *
 *  AN APOSTROPHE IS DELETED, NOT HYPHENATED. `Ajani's Chosen` is `ajanis-chosen`; letting it fall
 *  through to the general rule gives `ajani-s-chosen`, a URL with a one-letter segment in it that
 *  no reader would type and no search would match. Both the typewriter and the typographic
 *  apostrophe are removed, because Scryfall's names carry either. This is also what Scryfall and
 *  EDHREC do, which matters: these URLs are guessable only if they are guessable the same way.
 *
 *  Every other run of non-alphanumerics collapses to ONE hyphen, so `Fire // Ice` does not leave a
 *  double one, and leading/trailing hyphens are trimmed. */
export function slugOf(name: string): string {
  return name
    .replace(/Æ/g, "AE").replace(/æ/g, "ae")
    .replace(/['\u2019]/g, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
