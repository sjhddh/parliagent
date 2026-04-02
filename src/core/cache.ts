import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ParliagentRequest } from "../contracts/request.js";
import type { ParliagentResponse } from "../contracts/response.js";

export interface CacheEntry {
  version: string;
  timestamp: number;
  ttlMs: number;
  request: { prompt: string; mode?: string; seed?: string; executionProfile?: string; seatIds?: string[] };
  response: ParliagentResponse;
}

export interface CacheConfig {
  enabled: boolean;
  directory: string;
  ttlMs: number;
  version: string;
}

const DEFAULT_CACHE_DIR = join(process.cwd(), ".parliagent", "cache");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CURRENT_VERSION = "1.0.0";

export function defaultCacheConfig(): CacheConfig {
  const envVal = (process.env.PARLIAGENT_CACHE ?? "").toLowerCase();
  const explicitlyOn = envVal === "on" || envVal === "true" || envVal === "1";
  return {
    enabled: explicitlyOn,
    directory: process.env.PARLIAGENT_CACHE_DIR ?? DEFAULT_CACHE_DIR,
    ttlMs: DEFAULT_TTL_MS,
    version: CURRENT_VERSION,
  };
}

export function computeCacheKey(
  request: ParliagentRequest,
  seatIds?: string[],
): string {
  const payload = JSON.stringify({
    prompt: request.prompt,
    mode: request.mode ?? "micro",
    seed: request.seed ?? "",
    executionProfile: request.executionProfile ?? "federated",
    seatIds: seatIds ? [...seatIds].sort() : [],
    fullParliagent: request.fullParliagent ?? false,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function readCache(
  key: string,
  config: CacheConfig,
): ParliagentResponse | undefined {
  if (!config.enabled) return undefined;

  const filePath = join(config.directory, `${key}.json`);
  if (!existsSync(filePath)) return undefined;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const entry: CacheEntry = JSON.parse(raw);

    if (entry.version !== config.version) return undefined;

    const age = Date.now() - entry.timestamp;
    if (age > config.ttlMs) return undefined;

    return entry.response;
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[parliagent] cache read failed for ${key}: ${err instanceof Error ? err.message : err}`);
    }
    return undefined;
  }
}

export function writeCache(
  key: string,
  request: ParliagentRequest,
  response: ParliagentResponse,
  config: CacheConfig,
  seatIds?: string[],
): void {
  if (!config.enabled) return;

  try {
    mkdirSync(config.directory, { recursive: true });

    const entry: CacheEntry = {
      version: config.version,
      timestamp: Date.now(),
      ttlMs: config.ttlMs,
      request: {
        prompt: request.prompt,
        mode: request.mode,
        seed: request.seed,
        executionProfile: request.executionProfile,
        seatIds,
      },
      response,
    };

    writeFileSync(
      join(config.directory, `${key}.json`),
      JSON.stringify(entry, null, 2),
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[parliagent] cache write failed for ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
