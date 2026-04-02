export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

export interface CompletionResult {
  content: string;
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  model: string;
  latencyMs: number;
}

export interface ModelAdapter {
  readonly providerId: string;
  complete(
    messages: ChatMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult>;
  isAvailable(): boolean;
}
