import { createContext, useContext } from "react";

/** WHICH FACE THE PAGE IS SHOWING (owner, 2026-09-08: "we can flip the double faced card, but we see
 *  all the events for both at the same time"). `CardShell` owns the flip and provides it here;
 *  `CardArt` turns the picture and `AbilityTable` keeps the rows of that face, wherever on the page
 *  it renders. Null outside a shell, which every other caller of the table is, so a table with no
 *  provider shows every row exactly as it always did. */
export interface FaceView {
  /** 0 for the front, 1 for the back. */
  face: number;
  /** The face names, split off "Front // Back". */
  names: string[];
}

export const FaceContext = createContext<FaceView | null>(null);

export function useFace(): FaceView | null {
  return useContext(FaceContext);
}
