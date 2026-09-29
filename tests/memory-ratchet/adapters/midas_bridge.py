#!/usr/bin/env python3
from __future__ import annotations

import dataclasses
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

from midas import HashingEmbedder, Memory, StructuralImportance
from midas.sqlite_store import SQLiteStore


def _epoch(value: str | None) -> float | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _provenance(event: dict[str, Any]) -> str:
    source = str(event.get("source") or "")
    kind = str(event.get("type") or "")
    if source.startswith("session:") and kind in {"decision", "rejection", "approval"}:
        return "user_confirmation"
    if kind in {"proposal", "inference", "noise_memory", "noise_session", "candidate_memory"}:
        return "planning"
    return "observation"


def _kind(event: dict[str, Any]) -> str:
    kind = str(event.get("type") or "")
    if kind in {"decision", "rejection", "approval"}:
        return "constraint"
    if kind in {"code_observation", "document_read", "tool_result"}:
        return "fact"
    if kind in {"proposal", "inference", "noise_memory", "noise_session", "candidate_memory"}:
        return "note"
    return "note"


def _memory(db_path: str) -> Memory:
    return Memory(
        store=SQLiteStore(db_path),
        embedder=HashingEmbedder(),
        importance_scorer=StructuralImportance(),
        supersede=True,
        supersede_conversational=False,
        nli=None,
        include_provenance=False,
        detect_standing=True,
    )


def _record(record: Any) -> dict[str, Any]:
    return {
        "id": record.id,
        "content": record.content,
        "kind": record.kind,
        "importance": record.importance,
        "source": record.source,
        "provenance": record.provenance,
        "actor": record.actor,
        "metadata": record.metadata,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "superseded_by": record.superseded_by,
    }


def _hit(hit: Any) -> dict[str, Any]:
    return {
        "record": _record(hit.record),
        "score": float(hit.score),
        "relevance": float(hit.relevance),
        "importance_norm": float(hit.importance_norm),
        "recency": float(hit.recency),
    }


def _decision(decision: Any) -> dict[str, Any]:
    return dataclasses.asdict(decision)


def setup(payload: dict[str, Any]) -> dict[str, Any]:
    db = str(payload["db_path"])
    Path(db).parent.mkdir(parents=True, exist_ok=True)
    store = SQLiteStore(db)
    return {
        "ok": True,
        "schema_version": store.schema_version(),
        "projects": payload.get("projects", []),
    }


def ingest(payload: dict[str, Any]) -> dict[str, Any]:
    event = payload["event"]
    mem = _memory(str(payload["db_path"]))
    metadata = {
        "project": event.get("project_id"),
        "branch": event.get("branch"),
        "revision_sha": event.get("revision_sha"),
        "event_id": event.get("id"),
        "session": event.get("session_id"),
        "harness": event.get("harness"),
        "repo_path": event.get("repo_path"),
    }
    rec = mem.remember(
        str(event.get("content") or ""),
        kind=_kind(event),
        source=str(event.get("source") or ""),
        provenance=_provenance(event),
        actor=str(event.get("harness") or "") or None,
        metadata=metadata,
        created_at=_epoch(event.get("at")),
    )
    return {"record": _record(rec)}


def recall(payload: dict[str, Any]) -> dict[str, Any]:
    mem = _memory(str(payload["db_path"]))
    query = str(payload.get("query") or "")
    limit = int(payload.get("limit") or 10)
    now = payload.get("now")
    metadata_filter = {
        "project": payload.get("project_id"),
        "branch": payload.get("branch"),
    }
    hits = mem.recall(
        query,
        limit=limit,
        now=float(now) if now is not None else None,
        metadata_filter=metadata_filter,
    )
    guards = {}
    for intended_use in payload.get("guard_uses", []):
        guards[intended_use] = _decision(
            mem.guard_reliance(
                query,
                intended_use=intended_use,
                limit=limit,
                now=float(now) if now is not None else None,
                metadata_filter=metadata_filter,
            )
        )
    return {
        "hits": [_hit(hit) for hit in hits],
        "guards": guards,
        "scope": metadata_filter,
    }


def main() -> None:
    payload = json.load(sys.stdin)
    op = payload.get("op")
    if op == "setup":
        result = setup(payload)
    elif op == "ingest":
        result = ingest(payload)
    elif op == "recall":
        result = recall(payload)
    else:
        raise ValueError(f"unsupported Midas bridge op: {op}")
    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
