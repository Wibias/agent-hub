---
name: security-review
description: >
  Practical security checklist and category depth for app/API/SaaS/CI audits:
  authn/authz, secrets scanning, CORS/headers, uploads, webhooks, deps,
  Semgrep/CodeQL leads, and variant analysis. Use for a standalone security
  review of a codebase before launch when no GitHub pull request is involved,
  or as depth after github-delivery already owns a PR security review. Do NOT
  use as the entrypoint for “security review on PR #N”, merge-ready,
  full-review, or GitHub babysit; those belong to github-delivery. Not
  audit-tooling, fuzz harnesses, or smart-contract-security.
---

# Security Review

The folder is named `security-review-redirect` so it sits beside the Cursor
`review-security` hijack. This file is the standalone checklist. It is not a
redirect.

## Routing (read first)

| Ask                                                                                 | Skill                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Security review on **PR / issue** / merge-ready / full-review / babysit             | **`github-delivery`** → `references/security-review.md` |
| Depth checklist / `security-checks.md` / `scan_secrets.py` while that workflow runs | **This skill** (loaded by github-delivery)              |
| Standalone pre-launch / whole-repo audit with **no** GitHub ship loop               | This skill                                              |

If the user named a PR or issue for ship-loop security, **stop and load `github-delivery`** instead of running this file as the whole review.

Use this skill for pragmatic security review of normal software projects. Focus
on concrete exploitable risks and launch-blocking issues, not generic
checklists. Prefer repo-specific evidence over assumptions.

## Workflow

1. Scope the target: app type, stack, auth model, data sensitivity, deployment
   target, public/private status, launch status, and whether fixes are expected.
2. Identify entry points: routes, controllers, RPC handlers, jobs, webhooks, CLI
   commands, CI workflows, deployment config, database access, upload paths,
   logging, API clients, middleware, and privileged scripts.
3. Review authn/authz first, then input handling, secrets/config, dependency
   risk, payments/webhooks, logging/privacy, file/network access, and unsafe
   defaults.
4. Run `python scripts/scan_secrets.py <path>` when local files are available.
   Treat output as leads, not proof, and never print full secrets.
5. Load `references/security-checks.md` for detailed category checks when
   reviewing web/API/SaaS/mobile projects.
6. Use static analysis as lead generation, not proof.
7. Validate each suspected bug with a concrete exploit path or mark it as not
   proven.
8. Report findings by severity with affected files, impact, evidence, and
   minimal fix.

## Tool Selection

- Use Semgrep for fast pattern scans and custom rules.
- Use CodeQL when data flow, taint tracking, or cross-file reasoning matters.
- Use variant analysis after one true bug is found.
- Use supply-chain review for dependency health, install scripts, package
  manager behavior, lockfiles, and maintainer risk.
- Use CI workflow review for untrusted PR input, prompt injection into agents,
  unsafe tokens, wildcard allowlists, and dangerous sandbox settings.
- Use false-positive review before claiming high-impact findings.

## Severity

- Critical: likely secret exposure, auth bypass, user data exposure, remote code
  execution, payment bypass, or production compromise.
- High: serious authorization, injection, insecure upload, session, dependency,
  privacy, or webhook issue exploitable under realistic conditions.
- Medium: meaningful hardening gap, missing validation, weak defaults, unsafe
  headers/CORS, incomplete rate limiting, or risky operational behavior.
- Low: defense-in-depth, documentation, observability, or polish issue.

## Review Heuristics

- Treat fail-open defaults as findings when production can run insecurely.
- Trace user-controlled input to privileged actions, filesystem writes, shell
  execution, SSRF-capable clients, SQL builders, template rendering, and logs.
- For auth bugs, prove the boundary: who can call it, what identity is used,
  and which object or tenant is touched.
- Prioritize server-side authorization over UI-only controls.
- Treat client-side feature gates, admin checks, and plan checks as insufficient
  unless backed by server-side enforcement.
- For config bugs, distinguish local development convenience from production
  behavior.
- For third-party services, verify environment variable naming, public/private
  key separation, webhook verification, and test/live mode boundaries.
- For dependency issues, avoid claiming current CVEs unless verified with an
  actual audit command or authoritative source.
- For legal/compliance topics, identify engineering risks and missing controls,
  but do not provide legal conclusions.
- For API design, look for footguns: permissive defaults, ambiguous ownership,
  bypassable checks, hidden global state, and surprising privilege escalation.

## Fix Guidance

- Add validation close to the boundary where untrusted input enters.
- Add authorization checks close to data access or protected action execution.
- Keep secrets on the server and remove them from client bundles, logs, and
  committed files.
- Prefer framework-native security helpers over custom logic.
- Add regression tests for auth, ownership, injection, upload, and webhook
  paths when feasible.
- Update `.env.example`, README, or deployment notes when fixes require
  configuration.

## Output

Use this format unless the user asks for code changes only:

```markdown
Security decision: Pass / Pass after fixes / Do not launch yet
Risk level: Low / Medium / High / Critical

Confirmed findings

- [Severity] Title
  Evidence: file/path:line or command output summary
  Risk: concrete impact
  Fix: specific remediation

Needs verification

- ...

Fastest safe fix plan

1. ...
2. ...
3. ...

Verification

- Commands run, files inspected, and areas not covered.
```

For each confirmed finding include:

- Severity and title
- Affected files or workflows
- Exploit or failure path
- Impact
- Fix strategy
- Verification command or manual check

## Resources

- `references/security-checks.md`: detailed checklist for web, API, SaaS,
  mobile, deployment, payments, privacy, repo hygiene, and operational review.
- `scripts/scan_secrets.py`: lightweight scanner for common secret-like
  patterns. Run locally as `python scripts/scan_secrets.py <project-path>`.