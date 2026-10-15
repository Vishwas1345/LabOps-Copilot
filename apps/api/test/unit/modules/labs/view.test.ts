import { describe, expect, it } from 'vitest';
import { toLabView } from '../../../../src/modules/labs/service.js';

const row = {
  id: 'lab-1',
  name: 'Lab one',
  labType: 'standard',
  status: 'failed' as const,
  source: 'simulated' as const,
  createdAt: new Date('2026-10-14T10:00:00.000Z'),
  updatedAt: new Date('2026-10-14T10:05:00.000Z'),
  dependencies: [{ dependencyId: 'dep-a' }, { dependencyId: 'dep-b' }],
};

describe('toLabView', () => {
  it('maps a row to the public view', () => {
    expect(toLabView(row)).toEqual({
      id: 'lab-1',
      name: 'Lab one',
      labType: 'standard',
      status: 'failed',
      source: 'simulated',
      dependencyIds: ['dep-a', 'dep-b'],
      createdAt: '2026-10-14T10:00:00.000Z',
      updatedAt: '2026-10-14T10:05:00.000Z',
    });
  });

  // A new column on the table must not leak into the API by accident.
  it('exposes only the declared fields', () => {
    const widened = { ...row, internalNote: 'do not expose' };

    expect(Object.keys(toLabView(widened)).sort()).toEqual(
      [
        'createdAt',
        'dependencyIds',
        'id',
        'labType',
        'name',
        'source',
        'status',
        'updatedAt',
      ],
    );
  });
});
