import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

const SECRET = 'sk-live-should-never-appear';

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line: string) => lines.push(line) });
  return { logger, output: () => lines.join('') };
}

describe('createLogger', () => {
  // Negative cases: each shape below leaked through the previous path-based
  // configuration. The assertion is on raw output, so no field can hide it.
  it.each([
    ['top level', { token: SECRET }],
    ['one level deep', { connection: { token: SECRET } }],
    ['two levels deep', { a: { b: { token: SECRET } } }],
    ['different casing', { a: { Token: SECRET } }],
    ['compound key', { a: { accessToken: SECRET } }],
    ['snake case', { provider: { api_key: SECRET } }],
  ])('never writes a secret logged at the %s', (_shape, payload) => {
    const { logger, output } = capture();

    logger.info(payload, 'event');

    expect(output()).not.toContain(SECRET);
    expect(output()).toContain('[redacted]');
  });

  it('still redacts request authorization headers', () => {
    const { logger, output } = capture();

    logger.info({ req: { headers: { authorization: SECRET } } }, 'request');

    expect(output()).not.toContain(SECRET);
  });

  it('keeps non-secret fields intact', () => {
    const { logger, output } = capture();

    logger.info({ incidentId: 'inc-1', tokenCount: 3 }, 'event');

    const line = JSON.parse(output()) as Record<string, unknown>;
    expect(line.incidentId).toBe('inc-1');
    expect(line.tokenCount).toBe(3);
    expect(line.service).toBe('labops-api');
  });
});
