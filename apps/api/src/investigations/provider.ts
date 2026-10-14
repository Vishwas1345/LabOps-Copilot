// The model behind an interface. Providers return raw, untrusted output; the
// timeout and failure classification are enforced here, never left to them.

import type { Prompt } from './prompt.js';

/**
 * Token counts, so modelMetadata can record what a real provider cost. Never
 * includes the key or any part of the request.
 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * What a provider hands back. `raw` is deliberately `unknown`: it is validated
 * by output-schema.ts, never trusted, and never inspected before that.
 */
export interface ProviderAnswer {
  raw: unknown;
  /** Absent for providers that do not report usage, such as the fixture. */
  usage?: ProviderUsage;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  analyse(prompt: Prompt, signal: AbortSignal): Promise<ProviderAnswer>;
}

/** A provider declined to answer. Recorded as a failure, never retried blindly. */
export class ProviderRefusalError extends Error {
  constructor() {
    super('provider refused to answer');
    this.name = 'ProviderRefusalError';
  }
}

export type ProviderFailure = 'TIMEOUT' | 'REFUSED' | 'PROVIDER_ERROR';

export type ProviderResult =
  | { ok: true; raw: unknown; usage?: ProviderUsage; latencyMs: number }
  | { ok: false; failure: ProviderFailure; latencyMs: number };

/**
 * Never throws. The race against the abort means a provider that ignores its
 * signal still cannot hold the job past the timeout.
 */
export async function callProvider(
  provider: LlmProvider,
  prompt: Prompt,
  timeoutMs: number,
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
  const started = Date.now();
  try {
    const answer = await Promise.race([provider.analyse(prompt, controller.signal), timedOut]);
    return {
      ok: true,
      raw: answer.raw,
      usage: answer.usage,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const failure: ProviderFailure = controller.signal.aborted
      ? 'TIMEOUT'
      : error instanceof ProviderRefusalError
        ? 'REFUSED'
        : 'PROVIDER_ERROR';
    return { ok: false, failure, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
