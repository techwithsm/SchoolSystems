/**
 * fetch() for external APIs, with a timeout and retries on network errors,
 * 429 and 5xx responses (exponential backoff). Throws on final failure.
 */
export async function fetchJson<T = unknown>(
  url: string,
  { timeoutMs = 30_000, retries = 3 }: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'SchoolSystemsDirectory-Sync/1.0' },
        cache: 'no-store',
      });
      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      lastError = new Error(`HTTP ${res.status} from ${url}`);
      if (!retryable) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Splits an array into chunks (keeps URLs and request bodies small). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
