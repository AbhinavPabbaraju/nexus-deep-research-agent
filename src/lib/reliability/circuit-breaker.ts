// ─── src/lib/reliability/circuit-breaker.ts ──────────────────────────────────
// Jane Street-style circuit breaker: tracks per-provider failure rates,
// opens circuit on threshold breach, half-opens for probe retries.

import type { CircuitBreakerState, CircuitState } from '@/lib/agent/types-v4';
import { logger } from '@/lib/observability/logger';

const DEFAULTS = {
  threshold: 3,          // failures before open
  resetTimeout: 30_000,  // 30s before half-open
  halfOpenProbes: 1,     // successful probes to close again
};

// In-memory store (use Redis in production for multi-instance)
const breakers = new Map<string, CircuitBreakerState>();

function getBreaker(provider: string): CircuitBreakerState {
  if (!breakers.has(provider)) {
    breakers.set(provider, {
      provider,
      state: 'closed',
      failureCount: 0,
      lastFailureTime: 0,
      nextRetryTime: 0,
      successCount: 0,
      threshold: DEFAULTS.threshold,
      resetTimeout: DEFAULTS.resetTimeout,
    });
  }
  return breakers.get(provider)!;
}

export function canCall(provider: string): boolean {
  const b = getBreaker(provider);
  const now = Date.now();

  if (b.state === 'closed') return true;

  if (b.state === 'open') {
    if (now >= b.nextRetryTime) {
      b.state = 'half-open';
      b.successCount = 0;
      logger.info({ provider }, 'Circuit half-open — probing');
      return true;
    }
    logger.warn({ provider, nextRetryMs: b.nextRetryTime - now }, 'Circuit OPEN — blocking call');
    return false;
  }

  // half-open: allow through
  return true;
}

export function recordSuccess(provider: string): void {
  const b = getBreaker(provider);
  if (b.state === 'half-open') {
    b.successCount++;
    if (b.successCount >= DEFAULTS.halfOpenProbes) {
      b.state = 'closed';
      b.failureCount = 0;
      logger.info({ provider }, 'Circuit CLOSED — provider recovered');
    }
  } else if (b.state === 'closed') {
    // Decay failure count on success
    b.failureCount = Math.max(0, b.failureCount - 1);
  }
}

export function recordFailure(provider: string): void {
  const b = getBreaker(provider);
  b.failureCount++;
  b.lastFailureTime = Date.now();

  if (b.state === 'half-open' || b.failureCount >= b.threshold) {
    b.state = 'open';
    b.nextRetryTime = Date.now() + b.resetTimeout;
    logger.error({ provider, failureCount: b.failureCount, nextRetryMs: b.resetTimeout }, 'Circuit OPENED');
  }
}

export function getBreakerStatus(provider: string): CircuitBreakerState {
  return { ...getBreaker(provider) };
}

export function getAllBreakerStatuses(): CircuitBreakerState[] {
  return Array.from(breakers.values()).map((b) => ({ ...b }));
}

// ── Exponential backoff with jitter ──────────────────────────────────────────
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitter: true,
};

export function computeDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY): number {
  const exponential = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
  if (!config.jitter) return exponential;
  // Full jitter: random in [0, exponential]
  return Math.floor(Math.random() * exponential);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  provider: string,
  config: RetryConfig = DEFAULT_RETRY,
  signal?: AbortSignal
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('AbortError');

    if (!canCall(provider)) {
      throw new Error(`CircuitOpen:${provider}`);
    }

    try {
      const result = await fn();
      recordSuccess(provider);
      return result;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      recordFailure(provider);

      if (attempt < config.maxAttempts - 1) {
        const delay = computeDelay(attempt, config);
        logger.warn({ provider, attempt, delay, error: lastError.message }, 'Retrying after delay');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
