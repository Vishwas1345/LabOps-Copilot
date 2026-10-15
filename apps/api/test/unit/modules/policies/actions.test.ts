import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_TYPES } from '../../../../src/modules/labs/actions.js';
import { ACTION_POLICIES } from '../../../../src/modules/policies/actions.js';

// The rows of the ARCHITECTURE §10 allow-list table, by action name.
function documentedActions(): string[] {
  const doc = readFileSync(new URL('../../../../../../ARCHITECTURE.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('### Action allow-list'), doc.indexOf('### Policy evaluation order'));
  return [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]);
}

describe('action allow-list', () => {
  // Adding an action means the enum, the policy and the doc table together.
  it('lists exactly the same actions in the enum, the policies and ARCHITECTURE §10', () => {
    const sorted = (list: readonly string[]) => [...list].sort();

    expect(sorted(Object.keys(ACTION_POLICIES))).toEqual(sorted(ACTION_TYPES));
    expect(sorted(documentedActions())).toEqual(sorted(ACTION_TYPES));
  });

  // Negative: no action accepts parameters, so nothing free-form reaches an executor.
  it.each(ACTION_TYPES)('rejects any parameter for %s', (action) => {
    expect(ACTION_POLICIES[action].parameters.safeParse({}).success).toBe(true);
    expect(ACTION_POLICIES[action].parameters.safeParse({ command: 'rm -rf /' }).success).toBe(
      false,
    );
  });
});
