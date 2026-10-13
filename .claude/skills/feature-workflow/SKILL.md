---
name: feature-workflow
description: Use when asked to build, implement, change or complete any feature, task or bug fix in this repository - before any code is written. Defines the mandatory sequence: explore the codebase first, ask for missing context rather than assume, plan before implementing, and never declare anything finished without tests passing.
---

# Feature workflow

**No code before context. No feature without tests. No completion without
verification.**

This skill governs the *process*. The technical rules live in `CLAUDE.md` and
the task-specific rules live in the other skills in `.claude/skills/`.

---

## The five rules

1. **Explore the codebase first.** Read before you write. Always. Do not
   propose a change to code you have not opened.
2. **Ask for enough context.** If a requirement is ambiguous, ask. Guessing is
   not faster — it is a wasted implementation and a wrong diff. One round of
   questions now beats three rounds of rework.
3. **Never jump to implementation.** Explore → clarify → plan → confirm → build.
   Skipping to code is the failure mode this skill exists to prevent.
4. **Never ship untested.** Untested work is not finished work. Not "I'll add
   tests later" — later does not exist in a ship.
5. **Honest status beats optimistic status.** If a step is blocked or skipped,
   say so plainly. Never claim a check passed that was not run. Lead with the
   uncomfortable part, and tell the human when their design is wrong — see
   `CLAUDE.md §14`. `CLAUDE.md §9`'s ban on fabricated numbers applies equally
   to test results.

---

## Phase 1 — Explore before proposing

Never open an editor before you have read the relevant code.

**Locate the surface area**

```bash
# what already exists for this domain?
grep -rn "<domain>" apps/api/src --include=*.ts
# what calls the thing I am changing?
grep -rn "<symbol>" apps/api/src apps/web/src --include=*.ts --include=*.tsx
# is there an existing skill for this exact task?
ls .claude/skills/
```

**Read, in this order**

1. `CLAUDE.md` — the rules for the area you are touching
2. The relevant skill in `.claude/skills/` (see the table in `CLAUDE.md §11`)
3. `ARCHITECTURE.md` — the section covering this boundary
4. The existing implementation — neighbouring routes, services, schemas, tests
5. `apps/api/prisma/schema.prisma` if the data model is involved

**Then state what you found** before proposing anything:

- What exists today, with `file.ts:42` references
- Which module owns the data and behaviour involved
- What pattern the codebase already uses for this kind of change
- What is genuinely missing

If you cannot cite file paths you have actually read, you have not explored
enough.

---

## Phase 2 — Ask for enough context

Ask **only** what you cannot determine from the code. Batch the questions into
one round rather than drip-feeding them.

**Always clarify when**

| Situation | Why it matters |
|---|---|
| Scope has more than one valid reading | Wrong scope = wrong build |
| The task touches a safety rule (`CLAUDE.md §5`, `§6`) | These are non-negotiable; a wrong choice is a safety defect |
| A schema or migration is implied | Migrations are hard to reverse once shipped |
| Behaviour on failure is unspecified | Failure paths are the ones being reviewed |
| More than one design is defensible | Pick one, state the trade-off, let them choose |
| Terminology is ambiguous | "Incident", "job", "action" have precise meanings here |
| Anything would touch a real external system | The MVP is simulated-only |

**Do not ask when** the answer is already in the repo, in `CLAUDE.md`, or in the
skill. Read it instead. Asking questions the repository already answers signals
you did not explore.

**Good questions are concrete and offer a default.** "Should this be
`202 + enqueue` or synchronous? Default: `202 + enqueue`, since the correlation
takes more than a request budget." Bad: "How should I do this?"

---

## Phase 3 — Plan before building

Produce a short plan and get it acknowledged. Keep it proportional to the task.

```
1. Files to change (existing / new), with why
2. Data model impact + constraints + migration
3. Contracts: schemas, events, payloads, API surface
4. Order of work, so each step leaves the repo type-checking
5. Tests: what behaviour, and its negative case
6. Docs: what in ARCHITECTURE.md / README.md becomes wrong if this lands
```

Flag anything that violates `CLAUDE.md` **in the plan, before writing it**, not
after.

---

## Phase 4 — Implement in slices

- Follow the conventions already in the touched files.
- Keep each slice type-checking. No half-migrated schema.
- One logical change at a time. No drive-by refactors.
- Write the test alongside the behaviour, not in a final pass.
- If you discover the plan was wrong, stop and say so. Do not silently pivot.

---

## Phase 5 — Test. This is a gate, not a formality.

**Nothing is finished until this passes.**

```bash
npm run build -w @labops/api        # backend typecheck
npx tsc --noEmit -p apps/web        # frontend typecheck
```

Plus the tests for what you changed, run against real infrastructure where the
layer requires it (integration tests use real Postgres + Redis — see
`CLAUDE.md §8`).

**Required for any behaviour change**

- [ ] A test for the new behaviour
- [ ] Its **negative** case — see `.claude/skills/negative-case-testing`
- [ ] Tests pass twice in a row from a clean database (proves determinism)
- [ ] No test output contains a secret
- [ ] `CLAUDE.md §12` definition of done, item by item

**If a test cannot be written, stop and say why.** Some legitimate reasons
exist (an unverified external API), but "it is hard to test" is not one. If it
genuinely cannot be tested, state that limitation explicitly in the final
report — do not mark it complete.

---

## Phase 6 — Close out honestly

Report:

- What changed, by file
- Which checks were run, and their actual results
- What was **not** done, and why
- Anything discovered that should be addressed next

If you did not run a check, do not list it. If a requirement was skipped, name
it. An accurate report with a stated gap is far more useful than a clean-sounding
one that hides one.

---

## Anti-patterns

| Do not | Instead |
|---|---|
| Implement, then explain | Explore, plan, then implement |
| Guess an ambiguous requirement | Ask, batched, with a stated default |
| Claim `npm test` passed | Run the actual configured script and show the output |
| Add tests at the end, if time allows | Write them with the behaviour |
| Mark done with a known gap unmentioned | State the gap explicitly |
| Refactor unrelated code mid-feature | Keep one logical change per commit |
| Bypass a safety rule to ship faster | The rule is the feature |
| Invent a CloudLabs capability to unblock the demo | Leave it `not_configured` |
| Flatter, then hedge the real problem | Lead with the problem (`CLAUDE.md §14`) |
| Agree because the human asked | Say why it is wrong; then implement their call |