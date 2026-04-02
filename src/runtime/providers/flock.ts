import type {
  ModelAdapter,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../adapter.js";
import { fetchWithRetry } from "../fetch.js";

/**
 * FLOCK adapter — OpenAI-compatible API with FLOCK-specific defaults.
 */
export class FlockAdapter implements ModelAdapter {
  readonly providerId = "flock";
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config?: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) {
    this.apiKey = config?.apiKey ?? process.env.FLOCK_API_KEY ?? "";
    this.baseUrl =
      config?.baseUrl ?? process.env.FLOCK_BASE_URL ?? "https://api.flock.io/v1";
    this.defaultModel = config?.defaultModel ?? process.env.FLOCK_MODEL ?? "flock-1";
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

    const response = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024,
          ...(options?.seed != null ? { seed: options.seed } : {}),
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`FLOCK API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content ?? "",
      tokensUsed: {
        prompt: data.usage?.prompt_tokens ?? 0,
        completion: data.usage?.completion_tokens ?? 0,
        total: data.usage?.total_tokens ?? 0,
      },
      model: data.model ?? model,
      latencyMs: Date.now() - start,
    };
  }
}
