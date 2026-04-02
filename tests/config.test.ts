import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, toRuntimeConfig, ParliagentConfig } from "../src/config.js";

describe("ParliagentConfig schema", () => {
  it("accepts empty config", () => {
    const result = ParliagentConfig.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts full config", () => {
    const result = ParliagentConfig.safeParse({
      primaryProvider: "anthropic",
      openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
      anthropic: { apiKey: "sk-ant-test", defaultModel: "claude-sonnet-4-20250514" },
      google: { apiKey: "goog-test" },
      defaults: { mode: "fast", trace: "full", outputLength: "long", safetyMode: "strict" },
      budgetOverrides: { maxTokens: 10000, maxLatencyMs: 20000 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid provider", () => {
    const result = ParliagentConfig.safeParse({ primaryProvider: "llama" });
    expect(result.success).toBe(false);
  });
});

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("PARLIAGENT_PRIMARY_PROVIDER", "");
    vi.stubEnv("PARLIAGENT_DEFAULT_MODE", "");
    vi.stubEnv("PARLIAGENT_DEFAULT_TRACE", "");
    vi.stubEnv("PARLIAGENT_MAX_TOKENS", "");
    vi.stubEnv("PARLIAGENT_MAX_LATENCY_MS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads config without errors when no file exists", () => {
    const config = loadConfig("/tmp/nonexistent-dir");
    expect(config).toBeDefined();
  });

  it("picks up OPENAI_API_KEY from env", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
    const config = loadConfig("/tmp/nonexistent-dir");
    expect(config.openai?.apiKey).toBe("sk-test-key");
  });

  it("picks up primary provider from env", () => {
    vi.stubEnv("PARLIAGENT_PRIMARY_PROVIDER", "google");
    const config = loadConfig("/tmp/nonexistent-dir");
    expect(config.primaryProvider).toBe("google");
  });

  it("picks up default mode from env", () => {
    vi.stubEnv("PARLIAGENT_DEFAULT_MODE", "balanced");
    const config = loadConfig("/tmp/nonexistent-dir");
    expect(config.defaults?.mode).toBe("balanced");
  });

  it("picks up budget overrides from env", () => {
    vi.stubEnv("PARLIAGENT_MAX_TOKENS", "5000");
    vi.stubEnv("PARLIAGENT_MAX_LATENCY_MS", "10000");
    const config = loadConfig("/tmp/nonexistent-dir");
    expect(config.budgetOverrides?.maxTokens).toBe(5000);
    expect(config.budgetOverrides?.maxLatencyMs).toBe(10000);
  });
});

describe("toRuntimeConfig", () => {
  it("converts config to runtime format", () => {
    const config: ParliagentConfig = {
      primaryProvider: "anthropic",
      openai: { apiKey: "sk-test" },
      anthropic: { apiKey: "sk-ant-test" },
    };
    const runtime = toRuntimeConfig(config);
    expect(runtime.primaryProvider).toBe("anthropic");
    expect(runtime.openai?.apiKey).toBe("sk-test");
    expect(runtime.anthropic?.apiKey).toBe("sk-ant-test");
  });
});
