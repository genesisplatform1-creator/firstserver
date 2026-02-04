---
name: "criticism-chain"
description: "Runs a rigorous, evidence-based critique loop on code, prompts, and system design. Invoke when user asks for deep criticism, postmortems, or quality audits."
---

# Criticism Chain

This skill creates a controlled, repeatable “chain of criticism” for open-ended critique. It converts vague critique into a managed backlog of validated issues with evidence, severity, and actionable fixes.

## Invoke When

- The user asks for deep criticism, brutal honesty, postmortems, or end-to-end review.
- You need to audit an MCP server, tool catalog, prompts, worker isolation, or reliability.
- The user wants criticism to be managed and controlled (not a one-off rant).

## Core Principles

- Evidence first: every criticism must cite concrete proof (logs, tests, code references, tool outputs).
- Actionability: each criticism must end in a change proposal or a clear “won’t fix” rationale.
- Scope control: keep critiques bounded, prioritized, and measurable.
- Verification: any fix proposal must include how it will be verified (tests, typecheck, runtime check).

## Criticism Loop (Always Follow)

1. **Inventory**
   - Enumerate what exists (tools/resources/prompts, entrypoints, worker pool, event store).
2. **Claims → Evidence**
   - For each claim, attach at least one evidence item:
     - Code references (file links + line ranges)
     - Command output (tests, typecheck, runtime logs)
     - Tool outputs (diff_review, risk_assess, vulnerability_scan, compliance_check)
3. **Impact**
   - Describe concrete consequences: correctness, security, performance, maintenance, UX, reliability.
4. **Fix**
   - Propose the minimal change that meaningfully improves the situation.
5. **Verify**
   - State the verification gates: lint, typecheck, tests, and a runtime probe when relevant.
6. **Backlog**
   - Convert critiques into a tracked list with status and priority.

## Managed Output Format (Use This)

Produce a numbered list. Each item must include all fields:

- **Title**: short, precise
- **Area**: correctness | security | performance | reliability | UX | maintainability | product | governance
- **Severity**: critical | high | medium | low
- **Evidence**: 1–3 bullet points with code references or outputs
- **Why It Matters**: one paragraph
- **Fix Proposal**: specific change (what to do, where)
- **Verification**: exact commands / checks
- **Status**: pending | in_progress | completed | won’t_fix

## Tool-Assisted Criticism (Recommended)

When available, use these to ground criticism:

- `tools/list`, `resources/list`, `prompts/list`: capability inventory
- `diff_review`: structured change critique for patches
- `risk_assess`: risk framing for architecture/refactors
- `vulnerability_scan`: quick pattern scan (label as heuristic; avoid overclaiming)
- `compliance_check`: lightweight standards checks (also heuristic)
- `admin_verify_integrity`: audit the event-store integrity chain

## Critique Domains Checklist (Run Top-Down)

1. **Product Fit**
   - What user outcome does each tool enable? What is missing for the target platform?
2. **API / Contracts**
   - Tool naming stability, schema clarity, versioning strategy, backward compatibility.
3. **Correctness**
   - Deterministic behavior, idempotency, error handling, edge cases, validation.
4. **Security**
   - Attack surface, sandboxing, policy gating, secrets handling, unsafe process/file ops.
5. **Reliability**
   - Shutdown behavior, process cleanup, timeouts, retries, health checks, crash recovery.
6. **Performance**
   - Backpressure, streaming, payload sizes, CPU/memory bounds, concurrency correctness.
7. **Observability**
   - Logs, metrics, traces, reproducible failure reports, verifier coverage.
8. **Maintenance**
   - Tests, type safety, linting strategy, modularity, deprecation, documentation debt.

## “No Fluff” Rules

- Don’t claim “secure” unless you can point to enforced controls.
- Don’t claim “correct” unless there are tests or formal checks.
- Label heuristic tools as heuristic.
- If evidence is missing, downgrade severity and mark “needs evidence”.

## Example Invocation Prompt (for the assistant)

“Run a Criticism Chain on this repo focusing on MCP protocol correctness, worker isolation, shutdown behavior, and security posture. Produce a prioritized backlog with evidence and verification steps.”
