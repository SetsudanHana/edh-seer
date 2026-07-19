export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmProvider {
  /** The model identifier, recorded on tag output. */
  readonly model: string;
  /** Send a chat message sequence, return the raw completion text. */
  chat(messages: ChatMessage[]): Promise<string>;
}
