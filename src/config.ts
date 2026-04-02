import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DebateModeEnum = z.enum(["micro", "fast", "balanced", "deep"]);
const TraceLevelEnum = z.enum(["none", "summary", "full"]);

const ExecutionProfileEnum = z.enum(["available", "federated", "supreme"]);

const ProviderEnum = z.enum(["openai", "anthropic", "google", "flock"]);

export const ParliagentConfig = z.object({
  primaryProvider: ProviderEnum.optional(),
  supremeProvider: ProviderEnum.optional(),
  openai: z
    .object({
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
  anthropic: z
    .object({
      apiKey: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
  google: z
    .object({
      apiKey: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
  flock: z
    .object({
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      defaultModel: z.string().optional(),
    })
    .optional(),
  defaults: z
    .object({
      mode: z.enum(["micro", "fast", "balanced", "deep"]).optional(),
      executionProfile: ExecutionProfileEnum.optional(),
      trace: z.enum(["none", "summary", "full"]).optional(),
      outputLength: z.enum(["short", "standard", "long"]).optional(),
      safetyMode: z.enum(["default", "strict"]).optional(),
      outputLanguage: z.string().optional(),
    })
    .optional(),
  budgetOverrides: z
    .object({
      maxTokens: z.number().positive().optional(),
      maxLatencyMs: z.number().positive().optional(),
    })
    .optional(),
});
export type ParliagentConfig = z.infer<typeof ParliagentConfig>;

const CONFIG_FILENAMES = [
  "parliagent.config.json",
  ".parliagent.json",
];

/**
 * Load configuration by merging (in priority order):
 * 1. Environment variables (highest priority)
 * 2. Config file in working directory
 * 3. Built-in defaults (lowest priority)
 */
export function loadConfig(cwd: string = process.cwd()): ParliagentConfig {
  const fileConfig = loadConfigFile(cwd);
  const envConfig = loadEnvConfig();

  return mergeConfigs(fileConfig, envConfig);
}

function loadConfigFile(cwd: string): ParliagentConfig {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);
    if (existsSync(filepath)) {
      try {
        const raw = readFileSync(filepath, "utf-8");
        const parsed = JSON.parse(raw);
        const result = ParliagentConfig.safeParse(parsed);
        if (result.success) return result.data;
        console.warn(`Warning: ${filepath} exists but failed schema validation`);
      } catch {
        console.warn(`Warning: ${filepath} exists but could not be parsed`);
      }
    }
  }
  return {};
}

function loadEnvConfig(): ParliagentConfig {
  const config: ParliagentConfig = {};

  if (process.env.PARLIAGENT_PRIMARY_PROVIDER) {
    const parsed = ProviderEnum.safeParse(process.env.PARLIAGENT_PRIMARY_PROVIDER);
    if (parsed.success) {
      config.primaryProvider = parsed.data;
    }
  }

  if (process.env.PARLIAGENT_SUPREME_PROVIDER) {
    const parsed = ProviderEnum.safeParse(process.env.PARLIAGENT_SUPREME_PROVIDER);
    if (parsed.success) {
      config.supremeProvider = parsed.data;
    }
  }

  if (process.env.PARLIAGENT_EXECUTION_PROFILE) {
    const parsed = ExecutionProfileEnum.safeParse(process.env.PARLIAGENT_EXECUTION_PROFILE);
    if (parsed.success) {
      config.defaults = { ...config.defaults, executionProfile: parsed.data };
    }
  }

  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) {
    config.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    };
  }
  if (process.env.OPENAI_MODEL) {
    config.openai = { ...config.openai, defaultModel: process.env.OPENAI_MODEL };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.ANTHROPIC_MODEL) {
    config.anthropic = { ...config.anthropic, defaultModel: process.env.ANTHROPIC_MODEL };
  }

  const googleKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (googleKey) {
    config.google = { apiKey: googleKey };
  }
  if (process.env.GOOGLE_MODEL) {
    config.google = { ...config.google, defaultModel: process.env.GOOGLE_MODEL };
  }

  if (process.env.FLOCK_API_KEY || process.env.FLOCK_BASE_URL) {
    config.flock = {
      apiKey: process.env.FLOCK_API_KEY,
      baseUrl: process.env.FLOCK_BASE_URL,
    };
  }
  if (process.env.FLOCK_MODEL) {
    config.flock = { ...config.flock, defaultModel: process.env.FLOCK_MODEL };
  }

  if (process.env.PARLIAGENT_DEFAULT_MODE) {
    const parsed = DebateModeEnum.safeParse(process.env.PARLIAGENT_DEFAULT_MODE);
    if (parsed.success) {
      config.defaults = { ...config.defaults, mode: parsed.data };
    } else {
      console.warn(`Warning: PARLIAGENT_DEFAULT_MODE="${process.env.PARLIAGENT_DEFAULT_MODE}" is not a valid mode`);
    }
  }

  if (process.env.PARLIAGENT_DEFAULT_TRACE) {
    const parsed = TraceLevelEnum.safeParse(process.env.PARLIAGENT_DEFAULT_TRACE);
    if (parsed.success) {
      config.defaults = { ...config.defaults, trace: parsed.data };
    } else {
      console.warn(`Warning: PARLIAGENT_DEFAULT_TRACE="${process.env.PARLIAGENT_DEFAULT_TRACE}" is not a valid trace level`);
    }
  }

  if (process.env.PARLIAGENT_DEFAULT_OUTPUT_LANGUAGE) {
    config.defaults = {
      ...config.defaults,
      outputLanguage: process.env.PARLIAGENT_DEFAULT_OUTPUT_LANGUAGE,
    };
  }

  if (process.env.PARLIAGENT_MAX_TOKENS) {
    config.budgetOverrides = {
      ...config.budgetOverrides,
      maxTokens: parseInt(process.env.PARLIAGENT_MAX_TOKENS, 10),
    };
  }

  if (process.env.PARLIAGENT_MAX_LATENCY_MS) {
    config.budgetOverrides = {
      ...config.budgetOverrides,
      maxLatencyMs: parseInt(process.env.PARLIAGENT_MAX_LATENCY_MS, 10),
    };
  }

  return config;
}

function mergeConfigs(
  fileConfig: ParliagentConfig,
  envConfig: ParliagentConfig,
): ParliagentConfig {
  return {
    primaryProvider: envConfig.primaryProvider ?? fileConfig.primaryProvider,
    supremeProvider: envConfig.supremeProvider ?? fileConfig.supremeProvider,
    openai: {
      ...fileConfig.openai,
      ...envConfig.openai,
    },
    anthropic: {
      ...fileConfig.anthropic,
      ...envConfig.anthropic,
    },
    google: {
      ...fileConfig.google,
      ...envConfig.google,
    },
    flock: {
      ...fileConfig.flock,
      ...envConfig.flock,
    },
    defaults: {
      ...fileConfig.defaults,
      ...envConfig.defaults,
    },
    budgetOverrides: {
      ...fileConfig.budgetOverrides,
      ...envConfig.budgetOverrides,
    },
  };
}

/**
 * Convert ParliagentConfig into RuntimeConfig for ModelPolicy.
 */
export function toRuntimeConfig(config: ParliagentConfig) {
  return {
    primaryProvider: config.primaryProvider,
    supremeProvider: config.supremeProvider,
    openai: config.openai,
    anthropic: config.anthropic,
    google: config.google,
    flock: config.flock,
  };
}
