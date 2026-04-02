import type {
  ModelAdapter,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../adapter.js";
import { fetchWithRetry } from "../fetch.js";

export class AnthropicAdapter implements ModelAdapter {
  readonly providerId = "anthropic";
  private apiKey: string;
  private defaultModel: string;

  constructor(config?: { apiKey?: string; defaultModel?: string }) {
    this.apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.defaultModel = config?.defaultModel ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6";
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(
    messages: ChatMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const start = Date.now();
    const model = options?.model ?? this.defaultModel;

    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const response = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0.7,
          ...(systemMessage ? { system: systemMessage.content } : {}),
          messages: nonSystemMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;

    return {
      content: data.content[0]?.text ?? "",
      tokensUsed: {
        prompt: inputTokens,
        completion: outputTokens,
        total: inputTokens + outputTokens,
      },
      model: data.model,
      latencyMs: Date.now() - start,
    };
  }
}
