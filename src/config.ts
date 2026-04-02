import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DebateModeEnum = z.enum(["micro", "fast", "balanced", "deep"]);
const TraceLevelEnum = z.enum(["none", "summary", "full"]);

const ExecutionProfileEnum = z.enum(["available", "federated", "supreme"]);

export const SunParliamentConfig = z.object({
  primaryProvider: z.enum(["openai", "anthropic", "google"]).optional(),
  supremeProvider: z.enum(["openai", "anthropic", "google"]).optional(),
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
export type SunParliamentConfig = z.infer<typeof SunParliamentConfig>;

const CONFIG_FILENAMES = [
  "sun-parliament.config.json",
  ".sun-parliament.json",
];

/**
 * Load configuration by merging (in priority order):
 * 1. Environment variables (highest priority)
 * 2. Config file in working directory
 * 3. Built-in defaults (lowest priority)
 */
export function loadConfig(cwd: string = process.cwd()): SunParliamentConfig {
  const fileConfig = loadConfigFile(cwd);
  const envConfig = loadEnvConfig();

  return mergeConfigs(fileConfig, envConfig);
}

function loadConfigFile(cwd: string): SunParliamentConfig {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);
    if (existsSync(filepath)) {
      try {
        const raw = readFileSync(filepath, "utf-8");
        const parsed = JSON.parse(raw);
        const result = SunParliamentConfig.safeParse(parsed);
        if (result.success) return result.data;
        console.warn(`Warning: ${filepath} exists but failed schema validation`);
      } catch {
        console.warn(`Warning: ${filepath} exists but could not be parsed`);
      }
    }
  }
  return {};
}

function loadEnvConfig(): SunParliamentConfig {
  const config: SunParliamentConfig = {};

  if (process.env.SUN_PARLIAMENT_PRIMARY_PROVIDER) {
    const p = process.env.SUN_PARLIAMENT_PRIMARY_PROVIDER;
    if (p === "openai" || p === "anthropic" || p === "google") {
      config.primaryProvider = p;
    }
  }

  if (process.env.SUN_PARLIAMENT_SUPREME_PROVIDER) {
    const p = process.env.SUN_PARLIAMENT_SUPREME_PROVIDER;
    if (p === "openai" || p === "anthropic" || p === "google") {
      config.supremeProvider = p;
    }
  }

  if (process.env.SUN_PARLIAMENT_EXECUTION_PROFILE) {
    const parsed = ExecutionProfileEnum.safeParse(process.env.SUN_PARLIAMENT_EXECUTION_PROFILE);
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

  if (process.env.GOOGLE_API_KEY) {
    config.google = { apiKey: process.env.GOOGLE_API_KEY };
  }
  if (process.env.GOOGLE_MODEL) {
    config.google = { ...config.google, defaultModel: process.env.GOOGLE_MODEL };
  }

  if (process.env.SUN_PARLIAMENT_DEFAULT_MODE) {
    const parsed = DebateModeEnum.safeParse(process.env.SUN_PARLIAMENT_DEFAULT_MODE);
    if (parsed.success) {
      config.defaults = { ...config.defaults, mode: parsed.data };
    } else {
      console.warn(`Warning: SUN_PARLIAMENT_DEFAULT_MODE="${process.env.SUN_PARLIAMENT_DEFAULT_MODE}" is not a valid mode`);
    }
  }

  if (process.env.SUN_PARLIAMENT_DEFAULT_TRACE) {
    const parsed = TraceLevelEnum.safeParse(process.env.SUN_PARLIAMENT_DEFAULT_TRACE);
    if (parsed.success) {
      config.defaults = { ...config.defaults, trace: parsed.data };
    } else {
      console.warn(`Warning: SUN_PARLIAMENT_DEFAULT_TRACE="${process.env.SUN_PARLIAMENT_DEFAULT_TRACE}" is not a valid trace level`);
    }
  }

  if (process.env.SUN_PARLIAMENT_DEFAULT_OUTPUT_LANGUAGE) {
    config.defaults = {
      ...config.defaults,
      outputLanguage: process.env.SUN_PARLIAMENT_DEFAULT_OUTPUT_LANGUAGE,
    };
  }

  if (process.env.SUN_PARLIAMENT_MAX_TOKENS) {
    config.budgetOverrides = {
      ...config.budgetOverrides,
      maxTokens: parseInt(process.env.SUN_PARLIAMENT_MAX_TOKENS, 10),
    };
  }

  if (process.env.SUN_PARLIAMENT_MAX_LATENCY_MS) {
    config.budgetOverrides = {
      ...config.budgetOverrides,
      maxLatencyMs: parseInt(process.env.SUN_PARLIAMENT_MAX_LATENCY_MS, 10),
    };
  }

  return config;
}

function mergeConfigs(
  fileConfig: SunParliamentConfig,
  envConfig: SunParliamentConfig,
): SunParliamentConfig {
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
 * Convert SunParliamentConfig into RuntimeConfig for ModelPolicy.
 */
export function toRuntimeConfig(config: SunParliamentConfig) {
  return {
    primaryProvider: config.primaryProvider,
    supremeProvider: config.supremeProvider,
    openai: config.openai,
    anthropic: config.anthropic,
    google: config.google,
  };
}
