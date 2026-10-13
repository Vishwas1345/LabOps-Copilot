# LabOps Copilot --- Project Specification

**Document type:** Product + technical specification  
**Status:** Proposed interview project; scope agreed, implementation not
started  
**Prepared for:** Spektra Systems technical project round  
**Interview context:** Technical interview with Amit Malik, COO of
Spektra Systems, completed successfully; the next stage is an open-ended
project assignment  
**Project owner:** Candidate  
**Last updated:** 13 October 2026

---

## 1. Executive summary

LabOps Copilot is a proposed AI-assisted incident response and recovery
coordination tool for cloud lab operations.

It helps an operations engineer move from many scattered lab failures
to:

1. A set of correlated, evidence-backed incidents.
2. An investigation that separates facts from hypotheses.
3. A safe, policy-checked recovery plan.
4. An approved and traceable recovery execution.
5. Verification of the outcome and a complete audit trail.

The project will be built as a **standalone SaaS-style web application** with a CloudLabs integration settings page. The architecture should support connecting to CloudLabs through its documented APIs and/or webhooks if Spektra provides the necessary documentation, credentials, permissions and sandbox access. Until those details are confirmed, the app must remain fully demonstrable using a clearly labelled simulator. No private-system access or real cloud recovery should be assumed, and the MVP must not modify real cloud resources. The goal is to demonstrate product thinking, backend engineering, AI integration, reliability, testing, observability, containerisation and CI/CD.

**Important positioning:** LabOps Copilot is a proposed companion
concept for a CloudLabs-style platform. It is not a claim that Spektra
lacks incident management, correlation, or recovery capabilities. Public
materials describe overlapping CloudLabs and Cosmos capabilities; the
project's differentiation must be framed as a focused workflow and
engineering demonstration unless further validation confirms a genuine
product gap.

---



## 2. Interview and business context

The candidate is progressing through the hiring process for an AI-Native
Full-Stack Developer role at Spektra Systems.

- Recruiter: Shilpa.
- The candidate completed a technical interview with Amit Malik, COO
of Spektra Systems.
- The technical interview covered coding and AI-assisted coding
practices.
- The candidate was advanced to the next stage and asked to build a
project of their choice.
- The project may use any topic and tech stack, but should demonstrate
a complete application with frontend, backend, AI integration and
meaningful engineering complexity.
- The candidate wants to demonstrate modern development tools and
practices while keeping the backend in Node.js, their primary stack.
- The preferred frontend is React.js or Next.js; this specification
uses Next.js with React.

The project should show that the candidate can take an ambiguous
problem, make architectural decisions, direct AI coding agents, review
generated code, validate security and correctness, and deliver a working
product.

### Candidate's technology constraints

- **Backend must be Node.js only.** Use TypeScript on Node.js; do not
introduce a Python backend.
- **Frontend:** Next.js/React is preferred.
- Demonstrate modern tooling where it serves a real purpose: Redis,
background jobs, Docker, CI/CD, testing, observability and AI
orchestration.
- Prefer a coherent modular architecture over unnecessary
microservices or technology collecting.
- Keep costs low; use simulated lab infrastructure and free tiers
where practical. Free-tier availability and quotas can change.

---



## 3. Understanding Spektra Systems and CloudLabs



### 3.1 Spektra Systems

Spektra Systems is a technology company with products and services
around cloud labs, software marketplace enablement and cloud reseller
operations. For this project, the relevant product is **CloudLabs**.

Useful official starting points to re-check during implementation:

- Spektra Systems: [https://spektrasystems.com/](https://spektrasystems.com/)
- CloudLabs: [https://cloudlabs.ai/](https://cloudlabs.ai/)
- CloudLabs help centre: [https://help.cloudlabs.ai/](https://help.cloudlabs.ai/)

The public CloudLabs integrations page advertises REST APIs for integration and lifecycle-related operations, and webhooks for selected events such as launches, completion, assessments, user activity and usage metrics. This is an initial discovery, not confirmation of the exact API contract needed by LabOps Copilot. Publicly accessible detail has not yet established the exact endpoints, auth scheme, scopes, webhook registration flow, payload signatures, rate limits, or whether infrastructure/provisioning failures and recovery actions are exposed. Verify the current official documentation and request access from Spektra before implementing a real connector.

Useful starting point: [https://cloudlabs.ai/platform/integrations](https://cloudlabs.ai/platform/integrations)

Product details and public claims may change. Verify the current official documentation before using specific claims in an interview
presentation.

### 3.2 What is CloudLabs?

CloudLabs helps organisations deliver hands-on, preconfigured
environments for activities such as:

- Technical learning and workshops.
- Product demonstrations and proofs of concept.
- Employee and partner training.
- Practical assessments.
- Software, cloud and infrastructure exercises.
- Other activities requiring a ready-to-use, controlled environment.

A lab is not necessarily a Docker container or a simulated cloud
console. Depending on the use case, it can include real cloud resources,
virtual machines, software installations, accounts, permissions,
networks and other configured components.

Azure and AWS are cloud infrastructure providers. CloudLabs is a
platform for organising and delivering lab experiences on configured
infrastructure and tools. The exact resources, permissions, limits and
lifecycle are defined by the lab setup. Users should not be assumed to
have unrestricted access to every service.

### 3.3 Why lab operations can be challenging

A platform that manages many lab environments may encounter operational
concerns such as:

- Provisioning timeouts and partial failures.
- Resource configuration errors.
- Permission or quota issues.
- Dependency outages.
- Repeated or duplicate events.
- Environments that fail at different stages.
- Failures that look similar but have different causes.
- Cost and resource lifecycle concerns.
- Need for clear incident history and safe recovery.

These are plausible challenges for a cloud-lab platform, not claims that
Spektra currently experiences any particular incident or lacks a
particular feature.

---



## 4. CloudLabs Cosmos and the need to differentiate

Public CloudLabs/Cosmos materials describe capabilities around
AI-assisted lab creation, generating lab assets, verification against
live portals, and AI-driven lab operations. CloudLabs also publicly
describes environment management, lifecycle and other operational
capabilities.

Therefore, this project must **not** be pitched as simply:

- A lab dashboard that shows healthy versus failed environments.
- A generic log summariser.
- Another AI lab generator.
- A replacement for CloudLabs or Cosmos.
- Proof that Spektra lacks monitoring, validation, or operational
automation.



### Proposed positioning

LabOps Copilot focuses on a particular end-to-end operational workflow:

> Correlate multiple failures into candidate incidents, build
> evidence-backed investigations, propose policy-checked recovery plans,
> coordinate approval and execution, and verify the final outcome.

This is a proposed focus, not a verified missing feature in CloudLabs
Cosmos. Public product descriptions cannot establish the full
capabilities of Spektra's internal systems. The candidate should avoid
claiming that no equivalent exists.

### How the concepts relate

- **CloudLabs:** Delivers and manages lab experiences and
environments.
- **CloudLabs Cosmos:** Publicly described as an AI-native workspace
supporting lab creation, verification and operations.
- **LabOps Copilot (proposed):** A focused prototype for incident
correlation and safe recovery orchestration. It could conceptually
complement a lab platform, but this prototype will use simulated
data and will not integrate with Spektra's systems.

If asked about differentiation, explain the specific workflow being
demonstrated and acknowledge that integration with or overlap against
existing Cosmos functionality would need to be validated with Spektra.

---



## 5. Product vision



### Vision statement

Help cloud-lab operators understand, prioritise and resolve related lab
failures safely, with an auditable record of evidence, decisions and
outcomes.

### Primary user

A cloud-lab operations engineer or support engineer responsible for
investigating lab incidents and restoring service.

### Core problem

An individual failed lab is a symptom. Several failed labs may share one
underlying cause, or they may be unrelated. Operators need to
distinguish these cases, gather evidence, choose safe actions and verify
whether recovery succeeded.

A dashboard may show which labs failed, but the proposed workflow goes
further by correlating events, explaining evidence, controlling recovery
and verifying the result.

### Core product promise

**From scattered failures to an evidence-backed, safely managed incident
workflow.**

---



## 6. Example scenario

The prototype simulates a training event with 500 labs. Thirty labs fail
within a short period.

Example failures:

- Several labs report a virtual-machine provisioning timeout.
- Some report network configuration errors.
- A few report permission-denied errors.

The system should not assume all 30 failures share one cause. It should:

1. Ingest and persist the events.
2. Identify likely relationships using error patterns, time windows and
  shared simulated dependencies.
3. Create candidate incident groups with reasons for grouping.
4. Keep unrelated failures separate when evidence differs.
5. Provide relevant logs and resource-state evidence to an AI
  investigation workflow.
6. Produce a structured diagnosis with supporting evidence and
  uncertainty.
7. Propose a recovery action.
8. Validate the proposal against deterministic safety rules.
9. Require approval where configured.
10. Execute a simulated recovery job.
11. verify the resulting lab state.
12. Record the full lifecycle in an audit trail.

All numbers and scenarios are illustrative project data, not Spektra
production data.

---



## 7. Functional requirements



### F1. Lab simulator

Build a deterministic simulator that can generate labs and realistic
operational events without real cloud resources.

Requirements:

- Create and list lab records.
- Represent states such as `provisioning`, `ready`, `failed`,
`recovering`, and `stopped`.
- Generate successful and failed provisioning events.
- Include configurable failure modes, such as timeout, permission
denied, network setup failure and dependency unavailable.
- Allow repeatable scenarios for demos and tests.
- Include shared simulated dependencies so correlation can be
demonstrated.
- Keep the simulator clearly labelled as simulated infrastructure.



### F2. Event ingestion and persistence

Event ingestion must support both simulated events and events received through an external provider adapter. Keep the normalized internal event model independent of CloudLabs-specific payload shapes.

Requirements:

- Validate incoming event payloads with Zod.
- Persist events in PostgreSQL.
- Include timestamps, lab IDs, event type, resource or dependency IDs,
error codes and structured metadata.
- Handle malformed events and duplicates safely.
- Add correlation IDs or trace IDs where appropriate.
- Do not store secrets or unnecessary personal information in event
payloads.



### F2a. CloudLabs integration settings and connector

Build a first-class **Settings → Integrations → CloudLabs** page. The intended product experience is that an authorized administrator configures the connection in LabOps Copilot instead of editing environment variables or source code.

UI requirements:

- Show connection status: `Not configured`, `Connecting`, `Connected`, `Error`, or `Needs attention`.
- Provide fields/configuration for the authentication method and tenant/environment identifiers only after the real CloudLabs API contract is confirmed. Never assume a particular auth scheme or endpoint.
- Keep credentials out of browser storage, frontend logs, URLs, and API responses. Submit secrets directly to the backend over HTTPS and store them encrypted at rest using a documented key-management approach; for local development, provide a safe `.env`/secret setup.
- Include **Test connection**, **Save connection**, **Disconnect**, and **Sync now** actions where supported.
- Show the last successful connection check, last sync, last received event, selected/supported event types, and recent integration errors.
- Display the generated webhook receiver URL only if CloudLabs requires customer-configured webhook delivery and the official setup process supports it. Clearly show any required verification/signing setup; never invent payload signing behavior.
- Let an administrator select from event types actually supported by the connected CloudLabs integration. Do not present unverified event types as available.
- Include a simulator/demo mode so the UI can be demonstrated without real credentials.

Connector architecture:

- Define a provider-neutral interface for operations such as `testConnection`, `fetchLabs`/`fetchStatuses` where supported, `registerWebhook` where supported, and `normalizeIncomingEvent`. Implement only methods supported by verified CloudLabs documentation.
- Implement the CloudLabs adapter behind this interface; keep CloudLabs-specific authentication, API calls and payload mapping inside that adapter.
- Accept webhook deliveries through a dedicated backend route only if the provider supports them. Validate the documented signature/token mechanism, timestamp/replay rules and schema where available. If signing is not supported, apply the strongest documented authentication and rate limiting and record the limitation.
- If polling is supported, use a bounded scheduled job with pagination, backoff, rate-limit handling and a persisted cursor/watermark where appropriate.
- Normalize external payloads into the internal event schema, preserve provider event IDs for deduplication, store source/provider metadata, and reject malformed payloads safely.
- Treat all provider payloads and logs as untrusted input. Redact credentials and sensitive values before persistence or AI context construction.
- Support event replay or safe reprocessing for debugging without creating duplicate incidents or recovery jobs.
- Record connection changes, test results, webhook receipt outcomes, sync runs and errors in the audit/observability trail.
- Use least-privilege credentials and read-only access by default. Recovery actions against real CloudLabs must remain disabled unless explicitly supported, authorized, sandboxed and separately reviewed. The MVP recovery worker executes simulated actions only.

**Integration gate:** Before implementing the live adapter, obtain official API documentation and a sandbox/test tenant or sample payloads from Spektra. Confirm authentication, endpoint availability, event types, rate limits, permissions, webhook security and permitted operations. If any capability is unavailable, document it and keep the simulator or polling fallback where appropriate. Never fabricate a working integration or claim a live connection without a successful test.

### F3. Incident correlation

The initial correlation engine should be deterministic and explainable.

Candidate signals:

- Matching error codes or normalised error categories.
- Temporal proximity.
- Shared resource or dependency IDs.
- Common preceding events.
- Similar state transitions.
- Repeated failures across the same simulated dependency.

Requirements:

- Calculate and persist candidate incident groups.
- Explain why each lab was included.
- Keep the possibility of false correlation visible.
- Do not merge incidents solely because raw error strings match.
- Allow an operator to inspect the affected labs and evidence.
- Support a confidence or strength score that is explainable, not
presented as certainty.

AI may help explain patterns or suggest additional hypotheses, but
deterministic logic should handle the core grouping and safety-critical
decisions.

### F4. AI investigation

Use an LLM API to analyse a bounded, relevant set of logs, events and
resource state.

Expected structured output:

- Incident summary.
- Candidate root cause.
- Supporting evidence references.
- Contradicting or missing evidence.
- Confidence/uncertainty.
- Suggested diagnostic checks.
- Recommended recovery action, if justified.
- Whether human approval is required.

Requirements:

- Use structured outputs and schema validation.
- Treat logs and event messages as untrusted data, not as instructions
to the model.
- Avoid sending unrelated or sensitive data to the model.
- Do not let the LLM directly execute shell commands or arbitrary
cloud actions.
- If evidence is insufficient, the model must be allowed to say so.
- Persist the investigation result and relevant model metadata,
without exposing secrets.



### F5. Recovery planning and policy checks

The AI proposes an action; deterministic backend code decides whether it
is permitted.

Potential simulated actions:

- Retry a provisioning operation.
- Re-check a simulated dependency.
- Re-run a validation step.
- Mark an incident as requiring manual investigation.

Requirements:

- Validate action type and target IDs.
- Check preconditions, such as whether a previous job is still
running.
- Enforce retry limits and cooldowns.
- Prevent duplicate execution using idempotency keys.
- Require human approval for configured actions.
- Reject unsupported actions.
- Record the policy decision and reason.
- Never execute arbitrary AI-generated commands.



### F6. Human approval

Requirements:

- Display the proposed action, target labs, rationale, evidence and
potential impact.
- Allow an authorised demo operator to approve or reject.
- Persist who approved/rejected and when.
- Revalidate preconditions at execution time because state may change
after approval.
- Expire stale approvals where appropriate.
- Do not execute a recovery action merely because an LLM recommends
it.

The prototype may use a simple operator role. If time permits, add
explicit role-based access control.

### F7. Background job execution

Use Redis and BullMQ for asynchronous work such as incident
investigation and recovery execution.

Requirements:

- Persist job state and outcomes.
- Use bounded retries and exponential backoff where appropriate.
- Handle worker failures and restarts.
- Make recovery actions idempotent.
- Avoid duplicate jobs when a user clicks repeatedly.
- Use explicit job states and timestamps.
- Record failures that exceed retry limits.
- Keep long-running operations out of the HTTP request lifecycle.



### F8. Recovery verification

Requirements:

- Verify the resulting simulated lab state after an action.
- Do not mark an incident resolved merely because a job was submitted.
- If recovery succeeds, record the evidence and transition the
incident to resolved.
- If recovery fails, keep the incident open or move it to an
appropriate failed/manual-review state.
- Capture before/after states and execution outcomes.



### F9. Operator dashboard

Build a polished, responsive operations interface containing:

- Lab status overview.
- Incident list and severity/status filters.
- Incident detail page.
- Affected labs and event timeline.
- Evidence panel.
- Incident correlation explanation.
- AI investigation summary and uncertainty.
- Proposed recovery action.
- Approval/rejection controls.
- Recovery job status.
- Verification outcome.
- Audit history.
- Live updates through Server-Sent Events (SSE).

A dependency graph using React Flow may show the relationship between
incidents, labs and shared simulated dependencies.

### F10. Audit trail

Persist an append-oriented audit record for important transitions:

- Event received.
- Incident created or updated.
- AI investigation started/completed.
- Recovery proposed.
- Policy validation passed/failed.
- Approval or rejection.
- Recovery job started/completed/failed.
- Verification passed/failed.
- Incident resolved or escalated.

Audit entries should include actor or system component, timestamp,
action, target, outcome and correlation ID. Avoid logging secrets or
full sensitive payloads.

---



## 8. Non-functional requirements



### Reliability

- The system should tolerate duplicate events and repeated API
requests.
- Job execution should be recoverable after worker restarts.
- Recovery operations must be idempotent.
- The application should represent partial failure honestly.



### Security

- Validate all API inputs.
- Use secure environment-variable handling for credentials.
- Keep LLM output untrusted.
- Enforce policy checks in backend code.
- Require approval for configured recovery actions.
- Redact secrets from logs and AI context.
- Apply least privilege for external integrations and use read-only credentials by default.
- Encrypt stored integration credentials; never return them to the client or log them.
- Authenticate and validate inbound webhooks using the provider-documented mechanism, with replay protection where possible.
- Apply rate limits, payload-size limits, timeouts and bounded retries to external API calls.
- Do not enable real recovery actions merely because a data connection is configured.
- Use rate limiting and appropriate authentication if the app is
exposed publicly.



### Observability

- Use structured logs with Pino.
- Use OpenTelemetry traces for requests and jobs.
- Propagate correlation/trace context across the API and workers where
feasible.
- Capture useful metrics such as event ingestion count, incident
processing duration, queue depth, AI request failures and recovery
success/failure.
- Do not log API keys, tokens or sensitive payloads.



### Maintainability

- Use TypeScript throughout the frontend and Node.js backend.
- Keep modules separated by responsibility.
- Use explicit state machines or documented transition rules for
incidents, jobs and labs.
- Document architectural trade-offs.
- Avoid premature microservices.

---



## 9. Proposed technology stack

The backend is **Node.js only**, using TypeScript. Do not introduce
Python services.

---

  Layer                   Technology              Purpose

---

  Frontend                Next.js + React +       Operator dashboard and
                          TypeScript              workflows

  Styling/UI              Tailwind CSS +          Consistent interface                           shadcn/ui + Animate.js               components

  Dependency graph        React Flow              Visualise
                                                  incident/lab/dependency
                                                  relationships

  Backend runtime         Node.js + TypeScript    All backend processing

  HTTP API                Fastify                 REST endpoints and
                                                  server-side application

  Validation              Zod                     Request, event and LLM
                                                  output schemas

  ORM                     Prisma                  Type-safe database access
                                                  and migrations

  Primary database        PostgreSQL              Labs, events, incidents,
                                                  approvals, jobs metadata
                                                  and audit trail

  Queue/cache             Redis                   Queue coordination and
                                                  transient state

  Background jobs         BullMQ                  Asynchronous
                                                  investigation and
                                                  recovery workers

  AI                      LLM API with structured Evidence-based diagnosis
                          outputs                 and action
                                                  recommendations

  AI orchestration        LangGraph.js, if        Multi-step investigation
                          justified               with explicit state and
                                                  branching

  Real-time updates       Server-Sent Events      Push status updates to
                                                  the dashboard

  Logging                 Pino                    Structured Node.js logs

  Tracing/metrics         OpenTelemetry           End-to-end observability

  Unit/integration tests  Vitest                  Test business logic, APIs
                                                  and workers

  End-to-end tests        Playwright              Validate complete user
                                                  workflows

  Containerisation        Docker + Docker Compose Reproducible local
                                                  environment

  CI/CD                   GitHub Actions          Automated checks and
                                                  deployment workflow

  Version control         Git + GitHub            Source control, pull
                                              requests and CI

---



### Stack decisions

- Use a **modular monolith** with a separate worker process, not
microservices.
- Keep the API and worker code in the same TypeScript codebase
initially.
- Use LangGraph.js only if its persisted/branching workflow
capabilities materially help. A simpler explicit state machine may
be sufficient for the MVP.
- Use OpenTelemetry and Pino for demonstrable tracing and logs;
Grafana can be added if time allows and a compatible backend is
configured.
- Do not add Kubernetes, Kafka or a vector database unless a concrete
requirement emerges.
- Free coding-agent and hosting quotas can change; design the project
so development is not tied to a paid AI coding subscription.

---



## 10. High-level architecture

```text
Next.js / React dashboard
        |
        | REST API + SSE
        v
Node.js + Fstify API
        |
        +------ PostgreSQL
        |       Labs, events, incidents, evidence,
        |       approvals and audit records
        |
        +------ CloudLabs integration adapter
        |       Settings, credential handling, API client,
        |       supported webhook receiver and event normalizer
        |
        +------ Redis + BullMQ
                    |
                    v
             Incident worker
                    |
                    v
           Deterministic correlation
                    |
                    v
            AI investigation workflow
                    |
                    v
          Recovery proposal + policy engine
                    |
               Human approval
                    |
                    v
              BullMQ recovery job
                    |
                    v
            Simulated lab engine
                    |
                    v
          State verification + audit trail

External CloudLabs data enters through the adapter and is normalized
before it reaches the same event/correlation pipeline as simulator data.
The simulator remains available when no real connection is configured.
API and workers emit structured logs and OpenTelemetry traces.
```



### Main backend modules

Suggested module boundaries:

- `labs`: lab records, simulator state and lab lifecycle.
- `events`: ingestion, validation, deduplication and event queries.
- `integrations`: provider adapter interface, CloudLabs connector, connection settings, API client, webhook receiver, sync jobs and normalized event mapping.
- `secrets`: server-side credential encryption/decryption and redaction boundaries.
- `incidents`: correlation, incident lifecycle and evidence.
- `investigations`: LLM orchestration and structured diagnosis.
- `policies`: action validation, preconditions and retry limits.
- `approvals`: approval/rejection and authorisation.
- `jobs`: BullMQ queue definitions and worker handlers.
- `recovery`: simulated action execution and verification.
- `audit`: append-oriented action history.
- `observability`: logging, tracing and metrics configuration.

These are logical modules; they do not need to be separate services.

---



## 11. Suggested data model

Initial entities:

### IntegrationConnection

- Provider name (initially `cloudlabs`), display name and tenant/environment identifier where applicable.
- Connection state and last successful test timestamp.
- Encrypted credentials or a reference to a secret manager; never store plaintext credentials.
- Configured/supported event types, sync cursor and last sync timestamp where applicable.
- Created/updated timestamps and the user/admin responsible for changes.



### WebhookDelivery / IntegrationSyncRun

- Provider event ID or delivery ID, received timestamp, processing status, retry count and a redacted error summary.
- Idempotency/deduplication key and correlation/trace ID.
- Sync-run start/end times, pagination/cursor metadata and outcome where polling is supported.
- Avoid retaining full sensitive raw payloads by default; if raw payload retention is necessary for debugging, redact it and apply a retention policy.



### Lab

- `id`
- `name`
- `labType`
- `status`
- `dependencyIds` or relational dependency records
- `createdAt`
- `updatedAt`



### OperationalEvent

- `id`
- `labId`
- `eventType`
- `errorCode`
- `message`
- `resourceId` or `dependencyId`, if applicable
- `occurredAt`
- `metadata`
- `deduplicationKey`
- `traceId` or `correlationId`



### Incident

- `id`
- `title`
- `status`
- `severity`
- `correlationReason`
- `confidenceScore`
- `createdAt`
- `updatedAt`
- `resolvedAt`



### IncidentLab

Join table linking incidents to affected labs, including the reason or
evidence for the relationship.

### Investigation

- `id`
- `incidentId`
- `status`
- `summary`
- `candidateCause`
- `evidenceReferences`
- `missingEvidence`
- `confidence`
- `recommendedAction`
- `modelMetadata`
- `createdAt`



### RecoveryAction

- `id`
- `incidentId`
- `actionType`
- `targetIds`
- `parameters`
- `status`
- `idempotencyKey`
- `proposedBy`
- `approvedBy`
- `approvedAt`
- `executedAt`
- `result`
- `verificationResult`



### AuditEntry

- `id`
- `actorType`
- `actorId`
- `action`
- `targetType`
- `targetId`
- `outcome`
- `metadata`
- `correlationId`
- `createdAt`



### JobExecution

Store or reference queue job status, attempt count, error summary and
timing information. Avoid treating Redis as the only durable record of
business state.

The final schema should be adjusted as the implementation develops. Use
database constraints and transactions for critical state transitions.

---



## 12. API outline

Illustrative endpoints:

---

  Method                  Endpoint                                  Purpose

---

  `GET`                   `/api/labs`                               List labs and filter by
                                                                    status

  `GET`                   `/api/labs/:id`                           Get a lab and its
                                                                    recent events

  `POST`                  `/api/events`                             Ingest a simulated
                                                                    operational event

  `GET`                   `/api/incidents`                          List and filter
                                                                    incidents

  `GET`                   `/api/incidents/:id`                      Get incident, affected
                                                                    labs and evidence

  `POST`                  `/api/incidents/:id/investigate`          Queue an AI
                                                                    investigation

  `POST`                  `/api/incidents/:id/recovery-proposals`   Create a validated
                                                                    recovery proposal

  `POST`                  `/api/recovery-actions/:id/approve`       Approve a proposed
                                                                    action

  `POST`                  `/api/recovery-actions/:id/reject`        Reject a proposed
                                                                    action

  `GET`                   `/api/jobs/:id`                           Inspect background job
                                                                    state

  `GET`                   `/api/incidents/:id/audit`                Retrieve incident audit
                                                                    history

  `GET`                   `/api/events/stream`                      SSE stream for live
                                                                    dashboard updates

  `GET`                   `/api/integrations`                       List configured integrations and status

  `POST`                  `/api/integrations/cloudlabs/test`        Test submitted connection settings without returning secrets

  `PUT`                   `/api/integrations/cloudlabs`              Create/update CloudLabs connection configuration

  `DELETE`                `/api/integrations/cloudlabs`              Disconnect CloudLabs and revoke/delete stored credentials where supported

  `POST`                  `/api/integrations/cloudlabs/sync`         Trigger a manual sync if supported

  `POST`                  `/api/integrations/cloudlabs/webhooks`     Receive provider webhook deliveries if supported; verify according to official contract

  `GET`                   `/api/integrations/cloudlabs/deliveries`  Inspect recent redacted delivery/sync outcomes

  `POST`                  `/api/demo/scenarios/:name`               Trigger a deterministic
                                                                demo scenario

---

Demo-only endpoints must be disabled or protected in any public
deployment. Use a consistent API error format and validate all request
bodies.

---



## 13. AI design and boundaries



### AI responsibilities

The AI may:

- Summarise relevant evidence.
- Propose likely causes.
- Identify missing information.
- Suggest diagnostic checks.
- Recommend a predefined recovery action.
- Explain why an action may help.
- Produce a human-readable incident report.



### Deterministic backend responsibilities

The backend must:

- Validate the schema and targets of every action.
- Decide whether the action is allowed.
- Check current resource and job state.
- Enforce authorisation and approval.
- Apply idempotency and retry limits.
- Execute only predefined, supported actions.
- Verify outcomes.
- Persist the audit trail.



### Prompt-injection and untrusted input

Logs, error strings, lab guides and event metadata may contain arbitrary
text. Treat them as data, not instructions. Do not allow text in logs to
override system policies or authorise tool execution.

Use bounded context, redact sensitive values, validate structured output
and handle model timeouts or malformed responses. AI failure should not
corrupt incident state.

---



## 14. Testing strategy



### Unit tests

- Event validation and normalisation.
- Deduplication.
- Correlation scoring and explanation.
- Incident state transitions.
- Recovery policy decisions.
- Retry limits and idempotency-key handling.
- AI response schema validation.



### Integration tests

- API event ingestion into PostgreSQL.
- Event ingestion triggering a BullMQ job.
- Worker failure and retry handling.
- Approval/rejection and policy enforcement.
- Recovery execution and verification.
- Audit entry creation.



### End-to-end tests with Playwright

1. Open the dashboard.
2. Trigger a simulated failure scenario.
3. Confirm related events become a candidate incident.
4. Open the incident and inspect evidence.
5. Run the AI investigation using a controlled test response or a test
  model configuration.
6. Approve a permitted recovery action.
7. Observe the background job complete.
8. Verify the lab returns to a healthy state.
9. Confirm the audit history records each transition.

Also test negative cases:

- Similar-looking but unrelated failures are not blindly merged.
- A malformed AI response is rejected.
- A disallowed action is blocked.
- A repeated approval or duplicate request does not run recovery
twice.
- A stale approval is revalidated.
- A failed recovery is not marked resolved.
- Secrets are not emitted in logs.

Tests should be deterministic and not depend on a live LLM API for every
CI run. Use fixtures or a mock provider for most tests, with a separate
optional integration test for a real model.

---



## 15. Docker and CI/CD



### Local development

Use Docker Compose to run:

- PostgreSQL.
- Redis.
- API.
- Background worker.
- Next.js frontend.

Provide a `.env.example` with placeholder values, health checks,
migrations and a seed command. Do not commit real secrets.

### GitHub Actions pipeline

On pull requests and pushes:

1. Install dependencies with a lockfile.
2. Run formatting/lint checks.
3. Run TypeScript type checks.
4. Run unit tests.
5. Start required services for integration tests.
6. Run integration tests.
7. Build frontend and backend.
8. Run a targeted Playwright smoke test where practical.
9. Build container images.
10. Deploy from the protected main branch if a deployment target is
  configured.

Document the pipeline and include a visible successful run in the
repository.

---



## 16. Observability and demonstration

The project should show a complete incident trace.

Useful trace spans:

- `event.ingest`
- `incident.correlate`
- `investigation.queue`
- `investigation.llm`
- `recovery.policy_check`
- `recovery.execute`
- `recovery.verify`

Useful metrics:

- Events ingested.
- Candidate incidents created.
- Correlation processing duration.
- Queue depth and job latency.
- AI request success/failure and latency.
- Recovery success/failure rate.
- Number of retries.
- Time from first event to incident identification.
- Time from approved action to verified outcome.

Metrics and demo numbers must come from actual runs of the prototype. Do
not fabricate performance improvements or claim production scale.

---



## 17. UI and demo experience

The UI should feel like a polished operations product rather than a
generic chatbot.

### Main screens

1. **Operations overview:** Total labs, healthy/failed states, open
  incidents, queue status and recent activity.
2. **Incident list:** Severity, affected lab count, status, first-seen
  time and likely cause.
3. **Incident detail:** Timeline, correlation rationale, affected labs,
  shared dependencies and relevant evidence.
4. **AI investigation:** Hypothesis, supporting evidence, missing
  evidence and recommended next step.
5. **Recovery approval:** Proposed action, target, preconditions, risk
  and approve/reject controls.
6. **Execution view:** Job status, attempts, logs and verification
  outcome.
7. **Audit history:** Who/what did what and when.
8. **Dependency graph:** Visual representation of related labs and
  simulated dependencies.
9. **Integration settings:** CloudLabs connection status, credential setup, test connection, supported event subscriptions, last sync/last event, delivery health, and disconnect controls. Show simulator mode clearly when no live connection is configured.



### Recommended demo scenario

Create 20--50 simulated labs. Trigger a scenario with:

- A group of failures sharing a simulated dependency.
- A few unrelated permission failures.
- A duplicate event.
- One recovery that succeeds.
- One recovery that fails its preconditions and is blocked.

Demonstrate how the product distinguishes these cases, investigates the
likely shared incident, blocks unsafe recovery and records the final
outcome.

The negative case is essential: it demonstrates safe engineering, not
only the happy path.

---



## 18. Implementation plan

Build vertically so that a working product exists early.

### Phase 1 --- Repository and foundation

- Set up the repository and package structure.
- Create the Next.js UI and Fastify API.
- Configure TypeScript, linting, formatting and Zod.
- Add PostgreSQL, Prisma schema and migrations.
- Add Docker Compose.
- Add a health endpoint and a basic CI workflow.

**Deliverable:** The app starts reproducibly and passes its initial
checks.

### Phase 2 --- Lab simulator, event pipeline and integration foundation

- Define lab and normalized event models.
- Generate deterministic lab scenarios.
- Implement event ingestion and persistence.
- Add state transitions and deduplication.
- Define a provider adapter interface and simulator adapter.
- Build the CloudLabs integration settings UI and backend connection model.
- Review official CloudLabs docs and request sandbox access/sample payloads.
- Implement the real CloudLabs adapter only for verified, accessible capabilities; otherwise retain the simulator and clearly mark the connection as unavailable/not configured.
- Display live/simulated lab states with visible source labels.

**Deliverable:** A working operations dashboard, normalized event pipeline, and integration settings experience; a live connector only if official access and documentation are available.

### Phase 3 --- Incident correlation

- Implement rule-based correlation.
- Link candidate incidents to labs and events.
- Explain correlation decisions.
- Add tests for related and unrelated failures.

**Deliverable:** The system can turn a stream of failures into
explainable candidate incidents.

### Phase 4 --- AI investigation

- Add an LLM provider abstraction.
- Define strict Zod schemas for AI output.
- Gather bounded incident evidence.
- Implement structured diagnosis and uncertainty.
- Add a test/mocked provider.

**Deliverable:** Each incident can receive an evidence-backed
investigation report.

### Phase 5 --- Recovery workflow

- Define supported simulated actions.
- Implement policy checks and preconditions.
- Add human approval and rejection.
- Add Redis/BullMQ jobs and worker handlers.
- Implement idempotency, retry limits and outcome verification.
- Record audit entries.

**Deliverable:** A complete, safe incident-to-recovery workflow.

### Phase 6 --- Observability and quality

- Add Pino structured logging.
- Instrument key operations with OpenTelemetry.
- Add unit, integration and Playwright tests.
- Add CI service dependencies and build checks.
- Test worker restarts, duplicate requests and failure paths.

**Deliverable:** A reliable and inspectable implementation.

### Phase 7 --- Deployment and interview preparation

- Deploy the app if free-tier resources permit.
- Seed a repeatable demo scenario.
- Write the README, architecture diagram and trade-offs.
- Capture a short demo walkthrough.
- Prepare to explain failure handling, security, AI boundaries and
design decisions.

**Deliverable:** A working demo and a repository Amit can inspect.

---



## 19. Scope boundaries



### In scope for the MVP

- Simulated lab infrastructure as the guaranteed demo path.
- CloudLabs integration settings and provider-adapter architecture.
- A real CloudLabs connector only if official documentation, credentials and sandbox access are supplied; supported capabilities must be verified.
- Event ingestion and persistence from simulator and any verified connector.
- Explainable incident correlation.
- AI investigation using structured outputs.
- Safe recovery proposals and policy checks.
- Human approval.
- Background execution and verification.
- Audit trail.
- Docker, automated tests and CI.



### Out of scope for the MVP

- Assuming access to Spektra's private systems or undocumented endpoints.
- Real CloudLabs recovery execution in the MVP, unless separately authorized and safely sandboxed; default recovery remains simulated.
- Real Azure/AWS provisioning or destructive cloud operations.
- Replacement of CloudLabs or Cosmos.
- A general-purpose lab creation platform.
- Arbitrary shell-command execution by an LLM.
- Kubernetes or multi-service deployment.
- Multiple cooperating AI agents without a clear need.
- Claims of production-grade scale based only on a local prototype.

---



## 20. Risks and mitigations

---

  Risk                                Mitigation

---

  Existing Cosmos features overlap    Describe this as a proposed
                                      workflow, not a verified product
                                      gap. Ask Spektra about overlap if
                                      possible.

  CloudLabs API/webhook details are    Request official documentation,
  unavailable or access is restricted  credentials and sandbox access;
                                      retain simulator and avoid claiming
                                      an unverified live connection.

  Provider events do not include       Limit claims to available event
  infrastructure failures              types; use supported status APIs
                                      or keep the relevant scenarios simulated.

  Integration credentials or webhook  Encrypt credentials, redact logs,
  deliveries are compromised          validate documented auth/signatures,
                                      apply replay protection and rate limits.

  AI gives incorrect diagnosis        Require evidence references,
                                      uncertainty and human review.

  AI output contains an unsafe action Strict schemas and deterministic
                                      policy engine; only predefined
                                      actions are executable.

  Correlation groups unrelated        Explainable deterministic rules,
  failures                            tests and operator-visible
                                      rationale.

  Duplicate recovery requests         Idempotency keys, database
                                      constraints and current-state
                                      checks.

  Worker crashes mid-job              Persist business state, bounded
                                      retries and recoverable job
                                      handlers.

  Free AI quota is exhausted          Use provider abstraction, mock AI
                                      in tests, and support a controlled
                                      demo mode.

  Project scope grows too large       Build the end-to-end workflow
                                      first; add optional tools only when
                                      justified.

  Secrets leak into logs or prompts   Redaction, least privilege,
                                      `.env.example`, and no secrets in
                                  source control.

---

---



## 21. Success criteria

The project is successful when a reviewer can:

- Start the application from documented instructions.
- Trigger a repeatable lab-failure scenario.
- See related and unrelated failures handled appropriately.
- Inspect why an incident was created.
- View an AI investigation with evidence and uncertainty.
- Approve a permitted recovery action.
- See the background worker execute and verify recovery.
- See unsafe or stale actions blocked.
- Inspect a complete audit history.
- Run automated tests and see the CI pipeline pass.
- Follow the incident through structured logs and traces.

The goal is not to maximise the number of tools or claim that no other
product does this. The goal is to demonstrate sound engineering judgment
and a complete, testable workflow.

---



## 22. Interview narrative

A concise explanation for Amit:

> "I built LabOps Copilot as a focused incident-response prototype for
> cloud-lab operations. It ingests simulated operational events,
> correlates failures into explainable candidate incidents, and uses an
> LLM to produce evidence-backed investigations. The model cannot
> execute actions directly: a deterministic policy layer validates
> proposed recovery actions, an operator approves them, and a Node.js
> worker executes and verifies the recovery. I added asynchronous jobs,
> idempotency, audit history, automated end-to-end tests, Docker and
> CI/CD so the project demonstrates a complete engineering workflow
> rather than just an AI demo. I see it as a proposed companion concept,
> not a claim that CloudLabs or Cosmos lacks these capabilities."

Be ready to explain:

- Why Node.js and TypeScript are used throughout the backend.
- Why a modular monolith is appropriate for the prototype.
- Why Redis/BullMQ is used for asynchronous jobs.
- How duplicate jobs and retries are handled.
- How correlation differs from root-cause diagnosis.
- Why AI output is untrusted and how policies constrain it.
- How recovery success is verified.
- What is simulated and what would be needed for a real integration.
- Where the project might overlap with existing CloudLabs/Cosmos
features.

---



## 23. Final decisions

- **Project name:** LabOps Copilot.
- **Product focus:** Incident correlation, evidence-backed
investigation, safe recovery orchestration and verification.
- **Business context:** A proposed companion concept for
CloudLabs-style lab operations.
- **Differentiation stance:** Focused workflow hypothesis; not a
verified gap in CloudLabs Cosmos.
- **Backend:** Node.js + TypeScript + Fastify.
- **Frontend:** Next.js + React + TypeScript.
- **Data:** PostgreSQL + Prisma.
- **Jobs:** Redis + BullMQ.
- **AI:** LLM structured outputs; LangGraph.js only if it materially
helps.
- **Quality:** Vitest + Playwright.
- **Delivery:** Docker + Docker Compose + GitHub Actions.
- **Observability:** Pino + OpenTelemetry.
- **Integration:** CloudLabs settings page and provider adapter; live API/webhook connectivity is conditional on verified documentation, credentials and sandbox access.
- **Infrastructure:** Simulated recovery for the MVP; live CloudLabs data may be used only if access is explicitly provided and tested.
- **Primary demonstration:** From correlated failures to approved,
verified recovery, with evidence and auditability.

**The central principle:** Build a real operational workflow, use AI
where it adds value, keep safety-critical decisions deterministic, and
make every important action observable and testable.