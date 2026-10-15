// Zod's JSON Schema is not what Gemini accepts. Every rule here was found by
// calling the real API, not by reading the docs, which are wrong in two places:
//
//   - the docs show `type: ["string", "null"]` for nullable; the API rejects it
//     and requires `nullable: true`
//   - the docs list `additionalProperties` as supported; the Gemini Developer
//     API rejects it (Vertex supports it, this endpoint does not)
//
// Raw REST also requires UPPERCASE type names - the SDK maps lowercase, plain
// fetch does not.
//
// What this transform deliberately cannot carry across: maxLength, minLength,
// minimum and maximum. Gemini does not enforce them on this path. They are not
// lost, because output-schema.ts re-checks every one of them on the way back
// in. Provider-side constraint is a convenience; Zod is the boundary.

import { z } from 'zod';
import { investigationOutput } from '../output-schema.js';

export type GeminiType =
  | 'STRING'
  | 'NUMBER'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'ARRAY'
  | 'OBJECT';

export interface GeminiSchemaNode {
  type?: GeminiType;
  nullable?: boolean;
  enum?: readonly string[];
  properties?: Record<string, GeminiSchemaNode>;
  required?: readonly string[];
  items?: GeminiSchemaNode;
  minItems?: number;
  maxItems?: number;
}

/** JSON Schema type names as Zod emits them. */
const TYPE_NAMES: Record<string, GeminiType> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
  null: 'STRING',
};

// Keywords Gemini does not enforce on this path. Dropping them is deliberate:
// sending them is a 400, and pretending they are enforced would be a lie in a
// file whose whole job is honesty about the boundary.
//
// $ref and $defs are deliberately NOT here. A reference this transform cannot
// inline means the shape is unknown, and an empty OBJECT would invite the
// model to answer `{}`. That has to fail loudly instead.
const DROPPED = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'additionalProperties',
]);

export class UnsupportedSchemaError extends Error {
  constructor(readonly detail: string) {
    super(`cannot express this schema for Gemini: ${detail}`);
    this.name = 'UnsupportedSchemaError';
  }
}

function toGeminiType(value: unknown): GeminiType {
  const name = typeof value === 'string' ? value : undefined;
  const mapped = name ? TYPE_NAMES[name] : undefined;
  if (!mapped) throw new UnsupportedSchemaError(`unknown type ${String(value)}`);
  return mapped;
}

/**
 * Folds Zod's `anyOf: [X, { type: 'null' }]` into `{ type: X, nullable: true }`.
 * Anything else is refused rather than sent: a 400 on the first real incident
 * is far worse than a startup failure.
 */
function foldNullable(node: Record<string, unknown>): GeminiSchemaNode {
  const branches = node.anyOf;
  if (!Array.isArray(branches)) {
    throw new UnsupportedSchemaError('anyOf that is not a null union');
  }

  const nulls = branches.filter(
    (branch): branch is { type: string } =>
      typeof branch === 'object' && branch !== null && (branch as { type?: string }).type === 'null',
  );
  const inner = branches.filter(
    (branch) =>
      !(typeof branch === 'object' && branch !== null && (branch as { type?: string }).type === 'null'),
  ) as Record<string, unknown>[];

  if (nulls.length !== 1 || inner.length !== 1) {
    throw new UnsupportedSchemaError('anyOf that is not a single null union');
  }

  const folded = walk(inner[0]);
  return { ...folded, nullable: true };
}

function walk(node: unknown): GeminiSchemaNode {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new UnsupportedSchemaError(`expected a schema object, got ${typeof node}`);
  }

  const source = node as Record<string, unknown>;

  if ('anyOf' in source) return foldNullable(source);

  const out: GeminiSchemaNode = {};

  for (const [key, value] of Object.entries(source)) {
    if (DROPPED.has(key)) continue;

    switch (key) {
      case 'type':
        out.type = toGeminiType(value);
        break;
      case 'enum':
        // Enum values are data, not type names: they must not be uppercased.
        out.enum = value as readonly string[];
        break;
      case 'properties':
        out.properties = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([name, child]) => [
            name,
            walk(child),
          ]),
        );
        break;
      case 'items':
        out.items = walk(value);
        break;
      case 'required':
      case 'minItems':
      case 'maxItems':
        (out as Record<string, unknown>)[key] = value;
        break;
      default:
        throw new UnsupportedSchemaError(`keyword ${key}`);
    }
  }

  if (!out.type) throw new UnsupportedSchemaError('node without a type');
  return out;
}

/**
 * Converts one JSON Schema node. Exported so the transform can be tested
 * directly against schemas Zod does not currently produce.
 */
export function toGeminiSchema(node: unknown): GeminiSchemaNode {
  return walk(node);
}

/**
 * The schema Gemini receives, derived from the same Zod schema the output is
 * validated against, so the two can never drift apart.
 */
export function geminiResponseSchema(): GeminiSchemaNode {
  return toGeminiSchema(z.toJSONSchema(investigationOutput));
}