#!/usr/bin/env python3
"""Check that an AI-agent dynamic workflow artifact is complete enough to audit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess


REQUIRED_FILES = ("plan.md", "state.json", "orchestration.md", "final-report.md")
REQUIRED_DIRS = ("packets", "results")
WORKFLOW_STATUSES = {"pending", "in_progress", "review", "accepted", "blocked"}
PACKET_STATUSES = {
    "pending",
    "ready",
    "in_progress",
    "review",
    "needs_correction",
    "accepted",
    "blocked",
}
PACKET_KINDS = {"AFK", "HITL"}
REQUIRED_STATE_KEYS = (
    "workflow_id",
    "status",
    "repository",
    "ACCEPT",
    "merge_authorization",
    "packets",
)
REQUIRED_REPOSITORY_KEYS = (
    "root_name",
    "remote",
    "base_branch",
    "base_head",
    "working_branch",
    "working_head",
    "created_at",
    "last_validated_head",
)
REQUIRED_PACKET_KEYS = (
    "id",
    "kind",
    "status",
    "dependencies",
    "owner",
    "execution_wave",
    "result_artifact",
    "checks",
    "validated_findings",
    "correction_attempts",
    "reviewer_wave",
    "requested_input",
    "input_evidence",
)


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


def validate_repository(repository: object, failures: list[str]) -> None:
    if not isinstance(repository, dict):
        failures.append("state.repository must be an object")
        return

    for key in REQUIRED_REPOSITORY_KEYS:
        if key not in repository:
            failures.append(f"state.repository missing key: {key}")

    for key in (
        "root_name",
        "base_branch",
        "base_head",
        "working_branch",
        "working_head",
        "created_at",
        "last_validated_head",
    ):
        value = repository.get(key)
        if not isinstance(value, str) or not value.strip():
            failures.append(f"state.repository.{key} must be a non-empty string")

    remote = repository.get("remote")
    if remote is not None and (not isinstance(remote, str) or not remote.strip()):
        failures.append("state.repository.remote must be null or a non-empty string")


def validate_state(state: object, failures: list[str]) -> None:
    if not isinstance(state, dict):
        failures.append("state.json root must be an object")
        return

    for key in REQUIRED_STATE_KEYS:
        if key not in state:
            failures.append(f"Missing state key: {key}")

    workflow_id = state.get("workflow_id")
    if not isinstance(workflow_id, str) or not workflow_id.strip():
        failures.append("state.workflow_id must be a non-empty string")

    status = state.get("status")
    if status not in WORKFLOW_STATUSES:
        failures.append(
            "state.status must be one of: " + ", ".join(sorted(WORKFLOW_STATUSES))
        )

    validate_repository(state.get("repository"), failures)

    accept = state.get("ACCEPT")
    if accept is not None:
        if not isinstance(accept, dict):
            failures.append("state.ACCEPT must be null or an object")
        else:
            if not isinstance(accept.get("summary"), str) or not accept["summary"].strip():
                failures.append("state.ACCEPT.summary must be a non-empty string")
            if not isinstance(accept.get("recorded_at"), str) or not accept["recorded_at"].strip():
                failures.append("state.ACCEPT.recorded_at must be a non-empty ISO-8601 string")

    merge_authorization = state.get("merge_authorization")
    if merge_authorization is not None:
        if not isinstance(merge_authorization, dict):
            failures.append("state.merge_authorization must be null or an object")
        else:
            for key in ("verbatim_instruction", "source", "recorded_at", "consumed_at"):
                if key not in merge_authorization:
                    failures.append(f"state.merge_authorization missing key: {key}")
            for key in ("verbatim_instruction", "source", "recorded_at"):
                value = merge_authorization.get(key)
                if not isinstance(value, str) or not value.strip():
                    failures.append(
                        f"state.merge_authorization.{key} must be a non-empty string"
                    )
            consumed_at = merge_authorization.get("consumed_at")
            if consumed_at is not None and (
                not isinstance(consumed_at, str) or not consumed_at.strip()
            ):
                failures.append(
                    "state.merge_authorization.consumed_at must be null or a non-empty string"
                )

    packets = state.get("packets")
    if not isinstance(packets, list):
        failures.append("state.packets must be an array")
        return

    packet_ids: set[str] = set()
    packet_by_id: dict[str, dict] = {}
    for index, packet in enumerate(packets):
        prefix = f"state.packets[{index}]"
        if not isinstance(packet, dict):
            failures.append(f"{prefix} must be an object")
            continue

        for key in REQUIRED_PACKET_KEYS:
            if key not in packet:
                failures.append(f"{prefix} missing key: {key}")

        packet_id = packet.get("id")
        if not isinstance(packet_id, str) or not packet_id.strip():
            failures.append(f"{prefix}.id must be a non-empty string")
        elif packet_id in packet_ids:
            failures.append(f"Duplicate packet id: {packet_id}")
        else:
            packet_ids.add(packet_id)
            packet_by_id[packet_id] = packet

        if packet.get("kind") not in PACKET_KINDS:
            failures.append(f"{prefix}.kind must be AFK or HITL")
        if packet.get("status") not in PACKET_STATUSES:
            failures.append(
                f"{prefix}.status must be one of: " + ", ".join(sorted(PACKET_STATUSES))
            )

        dependencies = packet.get("dependencies")
        if not isinstance(dependencies, list) or not all(
            isinstance(value, str) and value.strip() for value in dependencies
        ):
            failures.append(f"{prefix}.dependencies must be an array of packet ids")

        owner = packet.get("owner")
        if not isinstance(owner, str) or not owner.strip():
            failures.append(f"{prefix}.owner must be a non-empty string")

        execution_wave = packet.get("execution_wave")
        if not isinstance(execution_wave, int) or isinstance(execution_wave, bool) or execution_wave < 1:
            failures.append(f"{prefix}.execution_wave must be an integer >= 1")

        result_artifact = packet.get("result_artifact")
        if not isinstance(result_artifact, str) or not result_artifact.strip():
            failures.append(f"{prefix}.result_artifact must be a non-empty string")

        checks = packet.get("checks")
        if not isinstance(checks, list) or not all(isinstance(value, str) for value in checks):
            failures.append(f"{prefix}.checks must be an array of strings")

        if not isinstance(packet.get("validated_findings"), list):
            failures.append(f"{prefix}.validated_findings must be an array")

        correction_attempts = packet.get("correction_attempts")
        if correction_attempts not in (0, 1):
            failures.append(f"{prefix}.correction_attempts must be 0 or 1")

        reviewer_wave = packet.get("reviewer_wave")
        if reviewer_wave not in (0, 1, 2):
            failures.append(f"{prefix}.reviewer_wave must be 0, 1, or 2")

        requested_input = packet.get("requested_input")
        if requested_input is not None and (
            not isinstance(requested_input, str) or not requested_input.strip()
        ):
            failures.append(f"{prefix}.requested_input must be null or a non-empty string")

        if packet.get("kind") == "HITL" and packet.get("status") == "ready":
            if packet.get("input_evidence") is None:
                failures.append(
                    f"{prefix} cannot be ready until HITL input_evidence is populated"
                )

    for index, packet in enumerate(packets):
        if not isinstance(packet, dict):
            continue
        dependencies = packet.get("dependencies")
        if not isinstance(dependencies, list):
            continue
        for dependency in dependencies:
            if dependency not in packet_ids:
                failures.append(
                    f"state.packets[{index}] depends on unknown packet id: {dependency}"
                )
        if packet.get("status") == "ready":
            unresolved = [
                dependency
                for dependency in dependencies
                if packet_by_id.get(dependency, {}).get("status") != "accepted"
            ]
            if unresolved:
                failures.append(
                    f"state.packets[{index}] cannot be ready before dependencies are accepted: "
                    + ", ".join(unresolved)
                )


def validate_live_provenance(
    workflow_dir: Path,
    state: dict,
    failures: list[str],
    refresh_provenance: bool,
) -> bool:
    repository = state.get("repository")
    if not isinstance(repository, dict):
        return False

    repo_root_text = git_output(workflow_dir, "rev-parse", "--show-toplevel")
    if repo_root_text is None:
        failures.append("stale workflow provenance: workflow is no longer inside a Git repository")
        return False

    repo_root = Path(repo_root_text).resolve()
    current_head = git_output(repo_root, "rev-parse", "HEAD")
    current_branch = git_output(repo_root, "branch", "--show-current") or "DETACHED"
    current_remote = git_output(repo_root, "remote", "get-url", "origin")
    base_branch = repository.get("base_branch")
    current_base_head = (
        git_output(repo_root, "rev-parse", "--verify", f"{base_branch}^{{commit}}")
        if isinstance(base_branch, str) and base_branch
        else None
    )

    if repository.get("root_name") != repo_root.name:
        failures.append(
            "stale workflow provenance: repository root changed "
            f"from {repository.get('root_name')} to {repo_root.name}"
        )
    stored_remote = repository.get("remote")
    if stored_remote is not None and current_remote is not None and stored_remote != current_remote:
        failures.append("stale workflow provenance: origin remote changed")
    if repository.get("working_branch") != current_branch:
        failures.append(
            "stale workflow provenance: working branch changed "
            f"from {repository.get('working_branch')} to {current_branch}"
        )
    if current_base_head is not None and repository.get("base_head") != current_base_head:
        failures.append(
            "stale workflow provenance: base branch moved "
            f"from {repository.get('base_head')} to {current_base_head}"
        )

    stored_working_head = repository.get("working_head")
    if current_head != stored_working_head:
        if refresh_provenance and not failures and current_head is not None:
            repository["working_head"] = current_head
            repository["last_validated_head"] = current_head
            return True
        failures.append(
            "stale workflow provenance: working HEAD changed "
            f"from {stored_working_head} to {current_head}; inspect the new head before refreshing provenance"
        )
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow_dir", help="Path to .workflow/<slug>")
    parser.add_argument(
        "--refresh-provenance",
        action="store_true",
        help="After inspecting an intentional same-branch HEAD advance, record the current HEAD as working_head and last_validated_head",
    )
    args = parser.parse_args()

    workflow_dir = Path(args.workflow_dir)
    failures: list[str] = []
    state: dict | None = None
    provenance_refreshed = False

    if not workflow_dir.is_dir():
        failures.append(f"Missing workflow directory: {workflow_dir}")
    for name in REQUIRED_FILES:
        path = workflow_dir / name
        if not path.is_file():
            failures.append(f"Missing file: {path}")
        elif not path.read_text(encoding="utf-8").strip():
            failures.append(f"Empty file: {path}")
    for name in REQUIRED_DIRS:
        path = workflow_dir / name
        if not path.is_dir():
            failures.append(f"Missing directory: {path}")

    state_path = workflow_dir / "state.json"
    if state_path.is_file():
        try:
            loaded_state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            failures.append(f"Invalid JSON in {state_path}: {exc}")
        else:
            validate_state(loaded_state, failures)
            if isinstance(loaded_state, dict) and not failures:
                state = loaded_state
                provenance_refreshed = validate_live_provenance(
                    workflow_dir,
                    state,
                    failures,
                    args.refresh_provenance,
                )

    packet_files = (
        sorted((workflow_dir / "packets").glob("*.md"))
        if (workflow_dir / "packets").is_dir()
        else []
    )
    result_files = (
        sorted((workflow_dir / "results").glob("*.md"))
        if (workflow_dir / "results").is_dir()
        else []
    )
    if not packet_files:
        failures.append("No packet files found under packets/")
    if not result_files:
        failures.append("No result files found under results/")

    if failures:
        print("Workflow verification failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    if provenance_refreshed and state is not None:
        state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        print(f"Workflow provenance refreshed: {state['repository']['working_head']}")

    print(f"Workflow verification passed: {workflow_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
