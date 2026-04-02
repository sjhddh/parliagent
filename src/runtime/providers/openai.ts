import type {
  ModelAdapter,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../adapter.js";
import { fetchWithRetry } from "../fetch.js";

/**
 * Models that require max_completion_tokens instead of max_tokens.
 * OpenAI's newer reasoning/o-series models reject the legacy parameter.
 */
const USES_MAX_COMPLETION_TOKENS = new Set([
  "o1", "o1-mini", "o1-preview", "o3", "o3-mini", "o3-pro",
  "o4-mini",
]);

function needsMaxCompletionTokens(model: string): boolean {
  const lower = model.toLowerCase();
  return USES_MAX_COMPLETION_TOKENS.has(lower) ||
    lower.startsWith("o1-") ||
    lower.startsWith("o3-") ||
    lower.startsWith("o4-");
}

export class OpenAIAdapter implements ModelAdapter {
  readonly providerId = "openai";
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config?: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) {
    this.apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl =
      config?.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.defaultModel = config?.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1";
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
    const tokenLimit = options?.maxTokens ?? 1024;

    const tokenParam = needsMaxCompletionTokens(model)
      ? { max_completion_tokens: tokenLimit }
      : { max_tokens: tokenLimit };

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
          ...tokenParam,
          ...(options?.seed != null ? { seed: options.seed } : {}),
          ...(options?.jsonSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: options.jsonSchema.name,
                    strict: true,
                    schema: options.jsonSchema.schema,
                  },
                },
              }
            : options?.jsonMode
              ? { response_format: { type: "json_object" } }
              : {}),
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
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
      model: data.model,
      latencyMs: Date.now() - start,
    };
  }
}
