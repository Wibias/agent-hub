#!/usr/bin/env python3
"""Create an AI-agent dynamic workflow artifact directory."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import re
import subprocess
from pathlib import Path


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:64].strip("-") or "workflow"


def write_new(path: Path, content: str) -> None:
    if path.exists():
        return
    path.write_text(content, encoding="utf-8")


def git_output(repo: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    value = result.stdout.strip()
    return value or None


def resolve_repository(base_branch: str | None) -> dict[str, object]:
    cwd = Path.cwd().resolve()
    repo_root_text = git_output(cwd, "rev-parse", "--show-toplevel")
    if repo_root_text is None:
        raise RuntimeError("new_workflow.py requires a Git repository for durable provenance")

    repo_root = Path(repo_root_text).resolve()
    working_head = git_output(repo_root, "rev-parse", "HEAD")
    working_branch = git_output(repo_root, "branch", "--show-current") or "DETACHED"
    if working_head is None:
        raise RuntimeError("cannot resolve current Git HEAD for workflow provenance")

    resolved_base = base_branch
    if resolved_base is None:
        for candidate in ("main", "master"):
            if git_output(repo_root, "rev-parse", "--verify", f"{candidate}^{{commit}}"):
                resolved_base = candidate
                break
        if resolved_base is None:
            if working_branch == "DETACHED":
                raise RuntimeError(
                    "cannot infer a base branch from detached HEAD; pass --base-branch"
                )
            resolved_base = working_branch

    base_head = git_output(repo_root, "rev-parse", "--verify", f"{resolved_base}^{{commit}}")
    if base_head is None:
        raise RuntimeError(f"cannot resolve base branch for workflow provenance: {resolved_base}")

    remote = git_output(repo_root, "remote", "get-url", "origin")
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "root_name": repo_root.name,
        "remote": remote,
        "base_branch": resolved_base,
        "base_head": base_head,
        "working_branch": working_branch,
        "working_head": working_head,
        "created_at": captured_at,
        "last_validated_head": working_head,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("title", help="Workflow title or task summary")
    parser.add_argument(
        "--root",
        default=".workflow",
        help="Directory where workflow runs are stored (default: .workflow)",
    )
    parser.add_argument("--slug", help="Optional explicit workflow slug")
    parser.add_argument(
        "--base-branch",
        help="Base branch to bind into repository provenance (default: infer main/master/current)",
    )
    args = parser.parse_args()

    try:
        repository = resolve_repository(args.base_branch)
    except RuntimeError as error:
        parser.error(str(error))

    slug = slugify(args.slug or args.title)
    run_dir = Path(args.root) / slug
    packets_dir = run_dir / "packets"
    results_dir = run_dir / "results"
    packets_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)

    state = {
        "workflow_id": slug,
        "status": "pending",
        "repository": repository,
        "ACCEPT": None,
        "merge_authorization": None,
        "packets": [],
    }

    write_new(
        run_dir / "plan.md",
        f"""# {args.title}

## Goal

## Success Criteria

## Current Context

## Constraints

## Risks

## Approval Required

## Work Packets

## Integration Policy

## Verification

## Reusable Artifacts
""",
    )
    write_new(
        run_dir / "orchestration.md",
        f"""# Orchestration: {args.title}

## Execution Rules

- Keep the original objective intact.
- Ask for approval before risky, expensive, external, or destructive actions.
- Keep immediate blocking work local.
- Delegate only bounded, disjoint, materially useful packets.
- Integrate packet results before final verification.

## Branching Rules

## Packet Prompts

## Completion Audit
""",
    )
    write_new(run_dir / "state.json", json.dumps(state, indent=2) + "\n")
    write_new(
        run_dir / "final-report.md",
        f"""# Final Report: {args.title}

## Outcome

## Accepted Results

## Rejected Results

## Conflicts Resolved

## Verification Evidence

## Remaining Risks

## Reusable Follow-up
""",
    )

    print(run_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
