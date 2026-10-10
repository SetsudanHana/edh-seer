/** THE KEY OF A FACE WHOSE NAME IS ANOTHER DECK CARD'S NAME (#1176): "<face> (<card>)". The report
 *  renames such a face to this so no two objects share a row key; the web maps the same string back to
 *  the face's node. ONE COPY, because the two halves must agree to the character. */
export function faceKey(face: string, card: string): string {
  return `${face} (${card})`;
}
