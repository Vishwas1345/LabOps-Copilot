#!/usr/bin/env node

/**
 * Dependency audit gate.
 *
 * Fails the build when npm reports a high or critical advisory that is not
 * recorded in the committed baseline. This lets the known advisories be tracked
 * and dated rather than hidden, while still stopping the tree from getting
 * worse.
 *
 * Usage:
 *   node scripts/audit-gate.mjs           check against the baseline
 *   node scripts/audit-gate.mjs --update  rewrite the baseline from current state
 *
 * Removing an entry from the baseline does not fix anything - it only stops the
 * build complaining. The fix is a dependency upgrade.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(repoRoot, '.github/audit-baseline.json');

/** GitHub advisory id for a path, or the package name when the entry is only a dependency chain. */
function advisoryId(entry) {
  const url = typeof entry === 'string' ? entry : entry.url;
  if (typeof url === 'string') {
    const match = url.match(/GHSA-[a-z0-9-]+/i);
    if (match) return match[0].toUpperCase();
  }
  return null;
}

function collectAdvisories(audit) {
  const found = new Map();

  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities ?? {})) {
    if (!BLOCKING_SEVERITIES.has(vulnerability.severity)) continue;

    // `via` mixes real advisories (objects) with dependency-chain entries
    // (strings naming another package). Only objects carry an advisory id.
    const ids = (vulnerability.via ?? [])
      .map(advisoryId)
      .filter((id) => id !== null);

    // A transitive package has no advisory of its own. Key those by package
    // name so two different transitive packages cannot collapse into one
    // baseline entry and mask each other.
    const key = ids.length > 0 ? ids.join(',') : `package:${name}`;

    found.set(key, {
      key,
      package: name,
      severity: vulnerability.severity,
      advisory: ids.length > 0 ? ids.join(', ') : 'no direct advisory (transitive)',
      url: (vulnerability.via ?? []).find((via) => typeof via === 'object')?.url ?? null,
      direct: vulnerability.isDirect === true,
      fixAvailable: typeof vulnerability.fixAvailable === 'object' ? true : vulnerability.fixAvailable === true,
    });
  }

  return [...found.values()].sort((a, b) => a.package.localeCompare(b.package));
}

function runAudit() {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  const output = result.stdout ?? '';

  if (!output.trim()) {
    console.error('audit-gate: npm audit produced no JSON output');
    process.exit(1);
  }

  try {
    return JSON.parse(output);
  } catch {
    console.error('audit-gate: could not parse npm audit output');
    process.exit(1);
  }
}

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  try {
    writeFileSync(summaryPath, `${lines.join('\n')}\n`, { flag: 'a' });
  } catch {
    // A missing summary file must never fail the gate.
  }
}

const update = process.argv.includes('--update');

const current = collectAdvisories(runAudit());

if (update) {
  const baseline = {
    comment:
      'Known high/critical advisories accepted pending an upgrade. Regenerate with: node scripts/audit-gate.mjs --update. Removing an entry does not fix anything.',
    generatedAt: new Date().toISOString().slice(0, 10),
    accepted: current.map((advisory) => ({
      ...advisory,
      reason: 'no fix available within the current major version',
    })),
  };

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`audit-gate: baseline updated with ${current.length} advisories`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error('audit-gate: .github/audit-baseline.json is missing or unreadable');
  process.exit(1);
}

const accepted = new Set((baseline.accepted ?? []).map((entry) => entry.key ?? entry.advisory));
const fresh = current.filter((advisory) => !accepted.has(advisory.key));

const rows = [
  '### Dependency audit',
  '',
  `Blocking severities: high, critical. Known advisories: ${accepted.size}. Found: ${current.length}. New: ${fresh.length}.`,
  '',
  '| Package | Severity | Advisory | Direct |',
  '| ------- | -------- | -------- | ------ |',
  ...current.map(
    (advisory) =>
      `| ${advisory.package} | ${advisory.severity} | ${fresh.some((f) => f.key === advisory.key) ? '**NEW** ' : 'accepted '}${advisory.advisory} | ${advisory.direct ? 'yes' : 'transitive'} |`,
  ),
];

if (current.length === 0) {
  rows.push('', 'No high or critical advisories.');
}

appendSummary(rows);

if (fresh.length > 0) {
  console.error('audit-gate: new high/critical advisories introduced\n');
  for (const advisory of fresh) {
    console.error(`  ${advisory.package} [${advisory.severity}] ${advisory.advisory}`);
  }
  console.error(
    '\nUpdate the dependency, or record the advisory in .github/audit-baseline.json with a reason.',
  );
  process.exit(1);
}

console.log(
  `audit-gate: no new high/critical advisories (${current.length} known, ${accepted.size} baselined)`,
);