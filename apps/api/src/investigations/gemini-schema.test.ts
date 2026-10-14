import { describe, expect, it } from 'vitest';
import { ACTION_TYPES } from '../labs/actions.js';
import {
  geminiResponseSchema,
  toGeminiSchema,
  UnsupportedSchemaError,
} from './gemini-schema.js';

// Exactly what the Gemini Developer API documents. A keyword outside this set
// is a 400 at request time, so this is the guard that keeps a future Zod
// upgrade from breaking the provider silently.
const ALLOWED = new Set([
  'type',
  'nullable',
  'enum',
  'properties',
  'required',
  'items',
  'minItems',
  'maxItems',
]);

/**
 * Collects schema keywords only. Walking structural keys (not every key)
 * keeps property names out of the result - "outcome" is a field name, not a
 * keyword.
 */
function keywords(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node !== 'object' || node === null) return found;

  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties') {
      for (const child of Object.values(value as Record<string, unknown>)) {
        keywords(child, found);
      }
      continue;
    }
    found.add(key);
    if (key === 'items') keywords(value, found);
  }
  return found;
}

const schema = geminiResponseSchema();

describe('geminiResponseSchema', () => {
  it('emits only keywords the endpoint accepts', () => {
    const used = [...keywords(schema)];

    expect(used.filter((key) => !ALLOWED.has(key))).toEqual([]);
  });

  it('uppercases type names, which raw REST requires', () => {
    expect(schema.type).toBe('OBJECT');
    expect(schema.properties?.summary.type).toBe('STRING');
    expect(schema.properties?.confidence.type).toBe('NUMBER');
    expect(schema.properties?.evidenceFor.type).toBe('ARRAY');
  });

  // Negative case for the transform: Zod emits anyOf for .nullable(), which
  // this endpoint rejects outright.
  it('folds nullable into the nullable flag rather than sending anyOf', () => {
    const cause = schema.properties?.candidateCause;
    const action = schema.properties?.recommendedAction;

    expect(cause?.type).toBe('STRING');
    expect(cause?.nullable).toBe(true);
    expect(cause).not.toHaveProperty('anyOf');

    expect(action?.type).toBe('STRING');
    expect(action?.nullable).toBe(true);
    expect(action).not.toHaveProperty('anyOf');
  });

  // Enum values are data. Uppercasing them would rename every action and make
  // every diagnosis unparseable.
  it('keeps enum values exactly as written', () => {
    expect(schema.properties?.outcome.enum).toEqual([
      'diagnosis',
      'insufficient_evidence',
    ]);
    expect(schema.properties?.recommendedAction.enum).toEqual([...ACTION_TYPES]);
  });

  // These are the constraints Gemini cannot enforce. They are dropped here and
  // re-checked by Zod, which is the only place they are actually guaranteed.
  it('drops the length and range keywords Gemini does not enforce', () => {
    const used = keywords(schema);

    for (const dropped of ['minLength', 'maxLength', 'minimum', 'maximum', '$schema']) {
      expect(used.has(dropped)).toBe(false);
    }
  });

  it('keeps the array bounds Gemini does support', () => {
    expect(schema.properties?.evidenceFor.maxItems).toBe(50);
    expect(schema.properties?.evidenceFor.items?.type).toBe('STRING');
  });

  it('lists every field as required, matching the strict Zod schema', () => {
    // Sorted on both sides: Zod emits declaration order, which is not the
    // assertion. Content equality is the point, not ordering.
    expect([...(schema.required ?? [])].sort()).toEqual(
      Object.keys(schema.properties ?? {}).sort(),
    );
  });

  it('is derived from the output schema, so the two cannot drift', () => {
    const fields = Object.keys(schema.properties ?? {}).sort();

    expect(fields).toEqual(
      [
        'candidateCause',
        'confidence',
        'diagnosticChecks',
        'evidenceAgainst',
        'evidenceFor',
        'missingEvidence',
        'outcome',
        'recommendedAction',
        'summary',
        'targetLabIds',
      ].sort(),
    );
  });

  // Negative: a schema the endpoint cannot express must fail loudly here, not
  // 400 on the first real incident hours later.
  it.each([
    ['an anyOf that is not a null union', { type: 'string', anyOf: [{ type: 'string' }, { type: 'number' }] }],
    ['a node with no type', { enum: ['a', 'b'] }],
    ['an unknown type name', { type: 'integer128' }],
    ['a keyword the endpoint rejects', { type: 'string', pattern: '^a' }],
    ['a $ref that was never inlined', { type: 'object', $ref: '#/$defs/thing' }],
  ])('refuses %s', (_label, input) => {
    expect(() => toGeminiSchema(input)).toThrow(UnsupportedSchemaError);
  });

  it('names what it could not express', () => {
    try {
      toGeminiSchema({ type: 'string', pattern: '^a' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnsupportedSchemaError).message).toContain('pattern');
      expect((error as UnsupportedSchemaError).detail).toBe('keyword pattern');
    }
  });

  it('folds a null union it can express', () => {
    expect(
      toGeminiSchema({ anyOf: [{ type: 'string', maxLength: 5 }, { type: 'null' }] }),
    ).toEqual({ type: 'STRING', nullable: true });
  });
});

describe('UnsupportedSchemaError', () => {
  it('is thrown rather than sent, and names what it could not express', () => {
    const error = new UnsupportedSchemaError('keyword $dynamicRef');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('$dynamicRef');
    expect(error.detail).toBe('keyword $dynamicRef');
  });
});