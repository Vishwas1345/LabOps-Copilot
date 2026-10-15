import { describe, expect, it } from 'vitest';
import { createGeminiProvider, stripCodeFence } from '../../../../src/modules/investigations/providers/gemini-provider.js';
import { buildPrompt } from '../../../../src/modules/investigations/prompt.js';
import type { Prompt } from '../../../../src/modules/investigations/prompt.js';
import { ProviderRefusalError } from '../../../../src/modules/investigations/providers/provider.js';

const KEY = 'test-key-not-a-real-credential';
const BASE = 'https://gemini.example.com/v1beta';

const prompt: Prompt = buildPrompt({
  incident: { id: 'inc-1', title: 't', severity: 'high', correlation: '' },
  failures: [],
  omittedFailures: 0,
});

const noSleep = () => Promise.resolve();

interface Call {
  url: string;
  init: RequestInit;
}

/**
 * A fetch double that records the url and init it was called with, typed with a
 * real signature so assertions read the call rather than cast it.
 */
function recordingFetch(
  respond: (call: Call, index: number) => Promise<Response>,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const alwaysOk = () => recordingFetch(async () => geminiOk('{"a":1}'));

function provider(fetchImpl: typeof fetch, maxAttempts = 3) {
  return createGeminiProvider({
    apiKey: KEY,
    model: 'gemini-test',
    baseUrl: BASE,
    maxAttempts,
    fetchImpl,
    sleep: noSleep,
  });
}

function run(fetchImpl: typeof fetch, maxAttempts = 3) {
  return provider(fetchImpl, maxAttempts).analyse(prompt, new AbortController().signal);
}

function geminiOk(text: string, usage?: { promptTokenCount: number; candidatesTokenCount: number }) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
      ...(usage ? { usageMetadata: usage } : {}),
    }),
    { status: 200 },
  );
}

describe('stripCodeFence', () => {
  it('unwraps a fenced json block', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leaves bare json alone', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  // Negative: no repair of anything else. A model that answers with prose must
  // still be rejected downstream rather than quietly coaxed into JSON.
  it('does not repair prose or partial json', () => {
    expect(stripCodeFence('Here is the answer: {"a":1}')).toBe('Here is the answer: {"a":1}');
    expect(stripCodeFence('{"a":')).toBe('{"a":');
    expect(stripCodeFence('')).toBe('');
  });
});

describe('createGeminiProvider', () => {
  it('sends the key as a header, never in the url', async () => {
    const { fetchImpl, calls } = alwaysOk();
    await run(fetchImpl);

    const headers = calls[0].init.headers as Record<string, string>;

    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
  });

  it('sends the system policy and the evidence block separately', async () => {
    const { fetchImpl, calls } = alwaysOk();
    await run(fetchImpl);

    const body = JSON.parse(calls[0].init.body as string);

    expect(body.systemInstruction.parts[0].text).toBe(prompt.system);
    expect(body.contents[0].parts[0].text).toBe(prompt.evidence);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT');
  });

  it('reports token usage when the provider sends it', async () => {
    const { fetchImpl } = recordingFetch(async () =>
      geminiOk('{"a":1}', { promptTokenCount: 120, candidatesTokenCount: 34 }),
    );

    expect((await run(fetchImpl)).usage).toEqual({ inputTokens: 120, outputTokens: 34 });
  });

  // The key must never reach a log, an error, or the modelMetadata the job
  // persists. This is the test that keeps that true.
  it('keeps the key out of the answer it returns', async () => {
    const { fetchImpl } = alwaysOk();

    expect(JSON.stringify(await run(fetchImpl))).not.toContain(KEY);
  });

  it('strips a code fence before returning raw output', async () => {
    const { fetchImpl } = recordingFetch(async () => geminiOk('```json\n{"a":1}\n```'));

    expect((await run(fetchImpl)).raw).toBe('{"a":1}');
  });

  // Negative: a block reason is a refusal, not something to retry.
  it('raises a refusal when the prompt is blocked', async () => {
    const { fetchImpl, calls } = recordingFetch(async () =>
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })),
    );

    await expect(run(fetchImpl)).rejects.toThrow(ProviderRefusalError);
    expect(calls).toHaveLength(1);
  });

  // A provider-side finish reason is the difference between "the model wrote
  // nonsense" and "we cut it off". Without it both look identical downstream.
  it('reports a MAX_TOKENS truncation rather than hiding it', async () => {
    const { fetchImpl } = recordingFetch(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"outcome"' }] } }],
        }),
      ),
    );

    const answer = await run(fetchImpl);

    expect(answer.finishReason).toBe('MAX_TOKENS');
    expect(answer.raw).toBe('{"outcome"');
  });

  it('reports an ordinary STOP finish reason too', async () => {
    const { fetchImpl } = recordingFetch(async () => geminiOk('{"a":1}'));
    const answer = await run(fetchImpl);

    expect(answer.finishReason).toBeUndefined();
  });

  // Negative: every refusal reason is a refusal, and none may be retried.
  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'])(
    'treats %s as a refusal and does not retry',
    async (reason) => {
      const { fetchImpl, calls } = recordingFetch(async () =>
        new Response(
          JSON.stringify({ candidates: [{ finishReason: reason, content: { parts: [{ text: '' }] } }] }),
        ),
      );

      await expect(run(fetchImpl)).rejects.toThrow(ProviderRefusalError);
      expect(calls).toHaveLength(1);
    },
  );

  // Negative: a cancelled call must not wait out the backoff we owe the
  // provider before noticing the caller has gone.
  it('does not sleep when the signal aborted during a retry', async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const { fetchImpl } = recordingFetch(async () => {
      controller.abort();
      return new Response('busy', { status: 503 });
    });

    await createGeminiProvider({
      apiKey: KEY,
      model: 'gemini-test',
      baseUrl: BASE,
      maxAttempts: 3,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    })
      .analyse(prompt, controller.signal)
      .catch(() => undefined);

    // The abort lands during the first response, so the next attempt must be
    // refused before its backoff rather than after it.
    expect(sleeps).not.toContain(750);
  });

  // Negative: an empty candidate list is not a success with an invented answer.
  it('returns empty raw output rather than inventing a diagnosis', async () => {
    const { fetchImpl } = recordingFetch(async () => new Response(JSON.stringify({ candidates: [] })));

    expect((await run(fetchImpl)).raw).toBe('');
  });

  // The free tier throttles hard, so 429 and 503 must be retried.
  it.each([429, 500, 502, 503, 504])('retries status %i', async (status) => {
    const { fetchImpl, calls } = recordingFetch(async (_call, index) =>
      index === 0 ? new Response('busy', { status }) : geminiOk('{"a":1}'),
    );

    expect((await run(fetchImpl)).raw).toBe('{"a":1}');
    expect(calls).toHaveLength(2);
  });

  it.each([429, 503])('gives up on %i once attempts are exhausted', async (status) => {
    const { fetchImpl, calls } = recordingFetch(async () => new Response('busy', { status }));

    await expect(run(fetchImpl, 2)).rejects.toThrow(String(status));
    expect(calls).toHaveLength(2);
  });

  // Negative: 400 means our request is malformed. Resending it wastes quota
  // and delays the incident, so it must fail on the first attempt.
  it.each([400, 401, 403, 404, 422])('does not retry status %i', async (status) => {
    const { fetchImpl, calls } = recordingFetch(async () => new Response('bad', { status }));

    await expect(run(fetchImpl)).rejects.toThrow(String(status));
    expect(calls).toHaveLength(1);
  });

  it('retries a network fault', async () => {
    const { fetchImpl } = recordingFetch(async (_call, index) => {
      if (index === 0) throw new Error('ECONNRESET');
      return geminiOk('{"a":1}');
    });

    expect((await run(fetchImpl)).raw).toBe('{"a":1}');
  });

  // Negative: an abort must stop work rather than burn the remaining attempts
  // against a caller that has already given up.
  it('stops immediately when the signal is already aborted', async () => {
    const { fetchImpl, calls } = alwaysOk();
    const controller = new AbortController();
    controller.abort();

    await expect(provider(fetchImpl).analyse(prompt, controller.signal)).rejects.toThrow(
      ProviderRefusalError,
    );
    expect(calls).toHaveLength(0);
  });

  it('passes the abort signal through to fetch', async () => {
    const { fetchImpl, calls } = alwaysOk();
    const controller = new AbortController();

    await provider(fetchImpl).analyse(prompt, controller.signal);

    expect(calls[0].init.signal).toBe(controller.signal);
  });

  it('never puts the key in the request path', async () => {
    const { fetchImpl, calls } = alwaysOk();
    await run(fetchImpl);

    expect(calls[0].url).toBe(`${BASE}/models/gemini-test:generateContent`);
    expect(calls[0].url).not.toMatch(/key=|api[_-]?key=/i);
  });

  it('tolerates trailing slashes on the base url', async () => {
    const { fetchImpl, calls } = alwaysOk();
    await createGeminiProvider({
      apiKey: KEY,
      model: 'gemini-test',
      baseUrl: `${BASE}///`,
      maxAttempts: 1,
      fetchImpl,
      sleep: noSleep,
    }).analyse(prompt, new AbortController().signal);

    expect(calls[0].url).toBe(`${BASE}/models/gemini-test:generateContent`);
  });

  it('treats a single attempt as exactly one call', async () => {
    const { fetchImpl, calls } = recordingFetch(async () => new Response('busy', { status: 503 }));

    await expect(run(fetchImpl, 1)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});