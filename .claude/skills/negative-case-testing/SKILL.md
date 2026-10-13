---
name: negative-case-testing
description: Use when writing or reviewing any test in this repository, and before declaring any feature complete. This project is judged on its safety and failure paths, not its happy path - enforces the mandatory negative cases, determinism rules, and the secret-leak check.
---

# Writing negative-case tests

## Preconditions

Read `CLAUDE.md §8` and `CLAUDE.md §12`.

**This project's interview value is the failure paths.** A feature with only a
happy-path test is incomplete, regardless of how well the happy path works.

## Rules for every test

1. **Never depend on a live LLM.** Use the fixture provider. One opt-in job may
   hit a real model; it is excluded from the default run.
2. **Never assert on wall-clock timings or generated prose.** Assert on
   structure, counts, state and recorded reasons.
3. **Deterministic scenarios.** Fixed seed, identical failures every run.
4. **No test output may contain a secret.** See the leak check below.

## Mandatory negative cases by area

### Correlation

- Same raw error string, different normalised categories → **must not merge**
- Different raw strings, same normalised category → **must merge**, and the
  reason must be readable from the stored `IncidentLab` row
- Chain A~B, B~C where A and C score below threshold → **two** clusters, not one
- Re-running correlation over the same window → no duplicate incidents

### AI investigation

- Malformed JSON → rejected, investigation `error`, incident untouched
- Unknown field in output → rejected, not stripped
- Action outside the enum → dropped, no action created
- Prompt injection inside event text → inert; does not change the proposed
  action or the schema honoured
- Model names a lab outside the incident → target discarded
- Timeout / refusal → incident stays `open`

### Policy and approval

- Action not in the allow-list → blocked, reason recorded
- Target outside the incident → blocked at step 2
- Precondition failing → blocked at step 3
- Rate limit exceeded → blocked at step 5
- **Duplicate approval → executes exactly once**
- **Stale approval → revalidated and blocked**
- Every block writes an audit entry naming the blocking step

### Execution and verification

- **Failed verification → incident stays open or goes to `manual_review`, never
  `resolved`**
- Worker killed mid-job → row reconciled, not stuck in `running`
- Retries exhausted → `failed` recorded, incident escalated
- Duplicate event delivery → one effect

### Secrets

- A credential submitted through the integration settings endpoint appears in
  **no** response body, **no** log line, **no** AI context
- Redaction survives a payload the simulator deliberately injects a token into

## How to check for secret leakage

Not by reading the code — by running it:

1. Run the full seeded scenario with the worker and API live.
2. Capture stdout, the log file and the audit rows.
3. Grep the captured output for the literal test secret and for the field names
   `token`, `credential`, `secret`, `password`, `authorization`.
4. Any hit is a failure, regardless of what the log line looks like otherwise.

A redaction test that does not inspect real output is not a redaction test.

## E2E (Playwright)

The full journey, ending in the audit history:

1. Open the dashboard
2. Trigger the seeded failure scenario
3. Confirm related events became a candidate incident **and** unrelated ones did
   not
4. Inspect the correlation rationale
5. Run the investigation against the fixture provider
6. Approve one permitted action, watch the job complete
7. Attempt an action that fails a precondition → blocked
8. Confirm the incident resolved only where verification passed
9. Confirm the audit history records every transition

## Definition of done

Before declaring work complete:

- [ ] The behaviour has a test
- [ ] The behaviour has its **negative** test
- [ ] Tests are deterministic and pass twice in a row from a clean database
- [ ] No test output contains a secret
- [ ] `npm run build -w @labops/api` passes
