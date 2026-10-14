#!/usr/bin/env node

/**
 * Verifies every workspace still declares the scripts the CI pipeline relies
 * on.
 *
 * Why this exists: if `npm run test` is deleted from a package.json, the test
 * job fails loudly with a missing-script error, which is good. But the subtler
 * failure is a pipeline that quietly stops asserting anything - a job that was
 * meant to be a gate becomes a no-op that always passes. This check makes that
 * failure explicit.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED = [
  { workspace: 'package.json', scripts: ['lint', 'typecheck', 'test', 'coverage'] },
  {
    workspace: 'apps/api/package.json',
    scripts: [
      'build',
      'lint',
      'typecheck',
      'test',
      'test:integration',
      'coverage',
      'prisma:validate',
      'prisma:migrate',
      'prisma:drift',
    ],
  },
  { workspace: 'apps/web/package.json', scripts: ['build', 'lint', 'typecheck', 'test', 'coverage'] },
];

const problems = [];

for (const { workspace, scripts } of REQUIRED) {
  const manifestPath = resolve(repoRoot, workspace);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    problems.push(`${workspace}: unreadable (${error.message})`);
    continue;
  }

  const declared = manifest.scripts ?? {};

  for (const script of scripts) {
    if (typeof declared[script] !== 'string' || declared[script].trim() === '') {
      problems.push(`${workspace}: missing required script "${script}"`);
    }
  }
}

if (problems.length > 0) {
  console.error('check-required-scripts: pipeline contract is broken\n');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error(
    '\nThese scripts back CI jobs. Restore them rather than deleting the job.',
  );
  process.exit(1);
}

console.log(
  `check-required-scripts: ${REQUIRED.reduce((total, entry) => total + entry.scripts.length, 0)} required scripts present across ${REQUIRED.length} manifests`,
);