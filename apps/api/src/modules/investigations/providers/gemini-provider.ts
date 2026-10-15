// The Gemini provider. Plain fetch against the REST endpoint: Google's own
// docs recommend calling it directly rather than through the SDK when the SDK
// is not already in use, and this project has no SDK dependency it cannot
// justify.
//
// The key is read once at construction and used only as a request header. It is
// never placed in a URL, never logged, and never returned. Config refuses to
// start with a plaintext http base url that is not loopback, so the header
// cannot leave the machine unencrypted.

import type { Prompt } from '../prompt.js';
import { geminiResponseSchema } from './gemini-schema.js';
import type { GeminiSchemaNode } from './gemini-schema.js';
import type { LlmProvider, ProviderAnswer } from './provider.js';
import { ProviderRefusalError } from './provider.js';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Total attempts, not extra retries. At least 1. */
  maxAttempts: number;
  /** Injectable so tests never open a socket. */
  fetchImpl?: typeof fetch;
  /** Injectable so tests do not really wait between attempts. */
  sleep?: (ms: number) => Promise<void>;
  /** Passed through to the provider on every attempt. */
  maxOutputTokens?: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const BACKOFF_MS = [0, 750, 2000, 5000];

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
}

/** Throttling (429) and server-side faults are worth a retry; other errors are not. */
function isTransient(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * The provider's reasons for ending a response without an answer. Each is a
 * refusal, and a refusal is never retried.
 */
const REFUSAL_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
]);

/**
 * Models under a schema constraint still fence their JSON and occasionally
 * add a sentence of commentary. Trimming the wrapper is a readability
 * concession, not a repair: anything still unparseable is rejected by Zod.
 */
export function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

export function createGeminiProvider(options: GeminiProviderOptions): LlmProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const attempts = Math.max(1, options.maxAttempts);
  // Built once per provider, not once per call: the schema is static, and
  // re-deriving it for every incident would be work thrown away each time.
  const schema: GeminiSchemaNode = geminiResponseSchema();

  return {
    name: 'gemini',
    model: options.model,

    async analyse(prompt: Prompt, signal: AbortSignal): Promise<ProviderAnswer> {
      let lastError: unknown;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        // Checked before the backoff, not after: a caller who has given up
        // should not be made to wait out a delay owed to the provider.
        if (signal.aborted) throw new ProviderRefusalError();

        const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        if (wait > 0) await sleep(wait);

        if (signal.aborted) throw new ProviderRefusalError();

        let response: Response;
        try {
          response = await doFetch(
            `${options.baseUrl.replace(/\/+$/, '')}/models/${options.model}:generateContent`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-goog-api-key': options.apiKey,
              },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: prompt.system }] },
                contents: [{ role: 'user', parts: [{ text: prompt.evidence }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseSchema: schema,
                  maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
                },
              }),
              signal,
            },
          );
        } catch (error) {
          // A network fault or an abort is not a schema problem; retrying a
          // deliberate abort would defeat the timeout in callProvider.
          if (signal.aborted) throw error;
          lastError = error;
          continue;
        }

        if (isTransient(response.status)) {
          lastError = new Error(`gemini responded ${response.status}`);
          continue;
        }

        if (!response.ok) {
          // 400 means our request is wrong: retrying sends the same bad
          // request. Surface it immediately.
          throw new Error(`gemini rejected the request: ${response.status}`);
        }

        const body = (await response.json()) as GeminiResponse;
        const blockReason = body.promptFeedback?.blockReason;
        if (blockReason) throw new ProviderRefusalError();

        const finishReason = body.candidates?.[0]?.finishReason;
        if (finishReason && REFUSAL_REASONS.has(finishReason)) {
          throw new ProviderRefusalError();
        }

        const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const usage = body.usageMetadata;

        // finishReason is returned even on success: MAX_TOKENS marks a cut-off
        // answer, so a later rejection is attributed to the limit, not the model.
        return {
          raw: stripCodeFence(text),
          finishReason,
          usage: usage
            ? {
                inputTokens: usage.promptTokenCount ?? 0,
                outputTokens: usage.candidatesTokenCount ?? 0,
              }
            : undefined,
        };
      }

      throw lastError ?? new Error('gemini provider exhausted its attempts');
    },
  };
}