import type {
  ModelAdapter,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../adapter.js";
import { fetchWithRetry } from "../fetch.js";

export class GoogleAdapter implements ModelAdapter {
  readonly providerId = "google";
  private apiKey: string;
  private defaultModel: string;

  constructor(config?: { apiKey?: string; defaultModel?: string }) {
    this.apiKey = config?.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
    this.defaultModel = config?.defaultModel ?? "gemini-2.5-flash";
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

    const contents = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Use x-goog-api-key header instead of URL query parameter to avoid
    // leaking the API key in server/CDN logs.
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents,
          ...(systemMessage
            ? { systemInstruction: { parts: [{ text: systemMessage.content }] } }
            : {}),
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens ?? 1024,
          },
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google AI API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
      };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = data.usageMetadata;

    return {
      content: text,
      tokensUsed: {
        prompt: usage?.promptTokenCount ?? 0,
        completion: usage?.candidatesTokenCount ?? 0,
        total: usage?.totalTokenCount ?? 0,
      },
      model,
      latencyMs: Date.now() - start,
    };
  }
}
