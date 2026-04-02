export interface FetchWithRetryOptions {
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  retryableStatuses?: number[];
}

const DEFAULTS: Required<FetchWithRetryOptions> = {
  retries: 1,
  backoffMs: 1000,
  timeoutMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const { retries, backoffMs, timeoutMs, retryableStatuses } = {
    ...DEFAULTS,
    ...opts,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok || !retryableStatuses.includes(response.status)) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);

      if (attempt < retries) {
        const delay = backoffMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError =
        error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        const delay = backoffMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("fetchWithRetry exhausted all retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
