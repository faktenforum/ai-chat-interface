/**
 * Retry an async operation a fixed number of times with a short delay between attempts.
 * Used for transient API failures (e.g. DNS, network timeouts, 5xx).
 */

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1500;

/** Network-related error messages that are worth retrying. */
const RETRYABLE_PATTERNS = [
  'fetch failed',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'network',
];

export interface RetryOptions {
  /** Max number of attempts (default 3). */
  attempts?: number;
  /** Delay in ms between attempts (default 1500). */
  delayMs?: number;
  /** Return true if the error is transient and worth retrying (default: network/5xx). */
  isRetryable?: (error: unknown) => boolean;
}

/** Default: retry on network-like errors or when error has retryable: true (e.g. 5xx). */
function defaultIsRetryable(error: unknown): boolean {
  if (error != null && typeof error === 'object' && (error as { retryable?: boolean }).retryable === true) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return RETRYABLE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Run an async function; on failure, if the error is retryable, wait then try again.
 * @param fn - Async function to run (no args)
 * @param options - attempts, delayMs, isRetryable
 * @returns Result of fn()
 * @throws Last error after all attempts exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
