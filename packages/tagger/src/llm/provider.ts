export interface LlmProvider {
  /** The model identifier, recorded on tag output. */
  readonly model: string;
  /** Send a prompt, return the raw completion text. */
  complete(prompt: string): Promise<string>;
}
