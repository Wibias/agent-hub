#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path.cwd()
PRESYNC = "f38e8bf18fa5fc82336f2083509f86cd08561be9"
SYNC = "bf347125bd51482c40909e3b09a5db59182917fe"
OLD = ROOT / "_upstream-old/impeccable/.agents/skills/impeccable"
NEW = ROOT / "_upstream-new/impeccable/.agents/skills/impeccable"
WORKFLOW = ROOT / ".github/workflows/tmp-impeccable-overlay-repair.yml"
SELF = ROOT / "scripts/tmp-impeccable-local-overlay-repair.py"


def run(*args: str, capture: bool = False) -> str:
    proc = subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=capture)
    return proc.stdout if capture else ""


def main() -> None:
    deleted = run(
        "git", "diff", "--diff-filter=D", "--name-only", f"{PRESYNC}..{SYNC}", "--", "skills/impeccable", capture=True
    ).splitlines()

    restored: list[str] = []
    legitimate_upstream_deletions: list[str] = []
    for repo_path in deleted:
        rel = Path(repo_path).relative_to("skills/impeccable")
        rel_posix = rel.as_posix()
        if rel_posix in {"SKILL.md", "UPSTREAM.md"} or rel_posix.startswith("tests/"):
            continue
        existed_in_old_upstream = (OLD / rel).is_file()
        exists_in_new_upstream = (NEW / rel).is_file()
        if not existed_in_old_upstream:
            run("git", "checkout", PRESYNC, "--", repo_path)
            restored.append(repo_path)
        elif not exists_in_new_upstream:
            legitimate_upstream_deletions.append(repo_path)

    print(f"restored Agent Hub-only files: {len(restored)}")
    print(f"kept upstream deletions: {len(legitimate_upstream_deletions)}")
    for path in legitimate_upstream_deletions:
        print(f"upstream-deleted: {path}")

    upstream_doc = ROOT / "skills/impeccable/UPSTREAM.md"
    body = upstream_doc.read_text(encoding="utf-8")
    marker = "Target-only evaluation or integration files are local Agent Hub assets and are not evidence of vendor drift.\n"
    replacement = (
        "Target-only evaluation or integration files are local Agent Hub assets and are not evidence of vendor drift. "
        "Agent Hub runtime-integration files that were never present in the pinned upstream distribution are local overlays too; "
        "an upstream refresh must preserve them unless a separate migration deliberately retires them.\n"
    )
    if marker in body:
        body = body.replace(marker, replacement, 1)
    elif replacement not in body:
        raise SystemExit("UPSTREAM local-overlay marker drifted")
    upstream_doc.write_text(body, encoding="utf-8")

    mismatches: list[str] = []
    for src in NEW.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(NEW)
        if rel.as_posix() == "SKILL.md":
            continue
        dst = ROOT / "skills/impeccable" / rel
        if not dst.is_file() or dst.read_bytes() != src.read_bytes():
            mismatches.append(rel.as_posix())
    if mismatches:
        raise SystemExit("shared vendor drift after overlay repair: " + ", ".join(mismatches))

    if WORKFLOW.exists():
        WORKFLOW.unlink()
    if SELF.exists():
        SELF.unlink()
    run("rm", "-rf", "_upstream-old", "_upstream-new")

    run("node", "knowledge/build-index.mjs")
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "add", "-A")
    run("git", "diff", PRESYNC, "--check")
    run("git", "commit", "-m", "Preserve Impeccable Agent Hub runtime overlays")


if __name__ == "__main__":
    main()
