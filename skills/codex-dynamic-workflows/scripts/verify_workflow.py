#!/usr/bin/env python3
"""Check that an AI-agent dynamic workflow artifact is complete enough to audit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


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
    "ACCEPT",
    "merge_authorization",
    "packets",
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow_dir", help="Path to .workflow/<slug>")
    args = parser.parse_args()

    workflow_dir = Path(args.workflow_dir)
    failures: list[str] = []

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
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            failures.append(f"Invalid JSON in {state_path}: {exc}")
        else:
            validate_state(state, failures)

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

    print(f"Workflow verification passed: {workflow_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
