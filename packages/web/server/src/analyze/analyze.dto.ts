import type { GameState } from "@edh-seer/engine";

export interface AnalyzeRequest {
  decklist: string;
  commanders?: string;
  /** A game state the owner set (roadmap W18). Optional; absent is the report as it always was. */
  state?: GameState;
}
