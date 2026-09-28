#!/usr/bin/env python3
import argparse
import os
import re
from pathlib import Path


DEFAULT_EXCLUDES = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    "coverage",
    "__pycache__",
}

PATTERNS = [
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{30,}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("stripe_secret", re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    (
        "assigned_secret",
        re.compile(
            r"(?i)\b(api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret)\b"
            r"\s*[:=]\s*['\"]?([A-Za-z0-9_./+=:@$%-]{12,})"
        ),
    ),
]


def is_binary(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            chunk = handle.read(1024)
    except OSError:
        return True
    return b"\0" in chunk


def redact(value: str) -> str:
    value = value.strip().strip("'\"")
    if len(value) <= 10:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


def should_skip(path: Path, root: Path) -> bool:
    rel_parts = path.relative_to(root).parts
    return any(part in DEFAULT_EXCLUDES for part in rel_parts)


def scan(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        dirnames[:] = [name for name in dirnames if name not in DEFAULT_EXCLUDES]
        for filename in filenames:
            path = current / filename
            if should_skip(path, root) or is_binary(path):
                continue
            try:
                lines = path.read_text(errors="ignore").splitlines()
            except OSError:
                continue
            for line_no, line in enumerate(lines, start=1):
                for label, pattern in PATTERNS:
                    match = pattern.search(line)
                    if not match:
                        continue
                    preview = match.group(2) if label == "assigned_secret" and match.lastindex else match.group(0)
                    yield path, line_no, label, redact(preview)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan a project for common secret-like patterns.")
    parser.add_argument("path", nargs="?", default=".", help="Project path to scan.")
    args = parser.parse_args()

    root = Path(args.path).expanduser().resolve()
    if not root.exists():
        print(f"Path not found: {root}")
        return 2

    findings = list(scan(root))
    if not findings:
        print("No common secret patterns found.")
        return 0

    for path, line_no, label, preview in findings:
        print(f"{path}:{line_no}: {label}: {preview}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
