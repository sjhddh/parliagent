export interface FetchWithRetryOptions {
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  retryableStatuses?: number[];
  jitter?: boolean;
}

const DEFAULTS: Required<FetchWithRetryOptions> = {
  retries: 3,
  backoffMs: 1000,
  timeoutMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
  jitter: true,
};

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

function addJitter(delay: number): number {
  return delay * (1 + Math.random() * 0.3);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const { retries, backoffMs, timeoutMs, retryableStatuses, jitter } = {
    ...DEFAULTS,
    ...opts,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const signals = init?.signal
        ? [controller.signal, init.signal]
        : [controller.signal];
      const composedSignal = signals.length > 1
        ? AbortSignal.any(signals as [AbortSignal, AbortSignal])
        : controller.signal;
      const response = await fetch(url, {
        ...init,
        signal: composedSignal,
      });

      clearTimeout(timeout);

      if (response.ok || !retryableStatuses.includes(response.status)) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);

      if (attempt < retries) {
        const retryAfter = response.status === 429
          ? parseRetryAfter(response)
          : undefined;
        const baseDelay = retryAfter ?? backoffMs * Math.pow(2, attempt);
        const delay = jitter ? addJitter(baseDelay) : baseDelay;
        await sleep(delay);
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError =
        error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        const baseDelay = backoffMs * Math.pow(2, attempt);
        const delay = jitter ? addJitter(baseDelay) : baseDelay;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("fetchWithRetry exhausted all retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
