# Docs

| Path | What it is | Read it when |
|---|---|---|
| `specs/labops-copilot/SPEC.md` | The product: problem, users, journey, rules, scope, acceptance criteria. Plain words, no code. | You need to know *what* is being built and why |
| `specs/labops-copilot/PLAN.md` | The implementation, phase by phase: endpoints, tables, files, tests, verification. | You are about to build or review a phase |
| `specs/google-sign-in/` | Optional Google sign-in beside password sign-in: spec and plan. | You touch sign-in or the operator model |
| `infra/INFRA.md` | How it runs: processes, ports, containers, env vars, migrations, CI, deployment. Marks what exists vs planned. | You touch Docker, CI, env config or the database setup |

Related, at the repo root:

- `ARCHITECTURE.md`: the design and the reasoning behind it (trust boundaries, data model, state machines, safety model).
- `README.md`: setup and project overview.
- `CLAUDE.md`: rules for anyone, human or agent, changing the code.

**Keeping docs true.** When a phase lands, update the matching rows in `PLAN.md`
and `INFRA.md` in the same pull request. A spec change needs agreement before
the plan changes.

New features get their own folder: `specs/<feature-slug>/` with `SPEC.md`, then
`PLAN.md`.
