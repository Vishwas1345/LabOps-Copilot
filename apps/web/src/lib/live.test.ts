import { describe, expect, it } from 'vitest';
import { isRelevant } from './live';

const event = (incidentId: string | null) =>
  JSON.stringify({ action: 'incident.transition', incidentId });

describe('isRelevant', () => {
  it('lets an incident page react to its own incident only', () => {
    expect(isRelevant(event('inc1'), 'inc1')).toBe(true);
    expect(isRelevant(event('inc2'), 'inc1')).toBe(false);
    expect(isRelevant(event(null), 'inc1')).toBe(false);
  });

  it('lets a page without an incident react to everything', () => {
    expect(isRelevant(event(null))).toBe(true);
    expect(isRelevant(event('inc2'))).toBe(true);
  });

  // Negative: malformed stream data is ignored, never trusted.
  it.each(['not json', '{}', JSON.stringify({ incidentId: 'inc1' }), 'null'])(
    'ignores %p',
    (data) => {
      expect(isRelevant(data)).toBe(false);
    },
  );
});
