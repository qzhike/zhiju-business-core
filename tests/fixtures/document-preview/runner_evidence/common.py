"""Shared filesystem and manifest checks for fixed Runner evidence tools."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


SOURCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:'-]{0,127}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ROLES = {"CUSTOMER_MATERIAL", "TEMPLATE", "PREVIOUS_REPORT", "TRUSTED_DECISION"}


class EvidenceError(ValueError):
    """An input or assertion cannot be supported by the available evidence."""


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"Cannot read JSON {path}: {exc}") from exc


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def relative_file(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise EvidenceError(f"Invalid relative path: {relative!r}")
    rel = Path(relative)
    if rel.is_absolute() or any(part in {"", ".", ".."} for part in rel.parts):
        raise EvidenceError(f"Unsafe relative path: {relative!r}")
    base = root.resolve()
    path = (base / rel).resolve()
    if not path.is_relative_to(base) or not path.is_file():
        raise EvidenceError(f"Missing or escaped file: {relative!r}")
    return path


def load_manifest(
    path: Path, workspace_root: Path
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Check caller-assigned identities against immutable materialized bytes."""
    manifest = read_json(path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sources"), list):
        raise EvidenceError("Input manifest requires sources[]")
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    sources: list[dict[str, Any]] = []
    for item in manifest["sources"]:
        if not isinstance(item, dict):
            raise EvidenceError("Every manifest source must be an object")
        source_id = item.get("sourceId")
        role = item.get("role")
        relative = item.get("materializedRelativePath")
        expected = item.get("sha256")
        if not isinstance(source_id, str) or not SOURCE_ID.fullmatch(source_id):
            raise EvidenceError(f"Invalid sourceId: {source_id!r}")
        if source_id in seen_ids:
            raise EvidenceError(f"Duplicate sourceId: {source_id}")
        if role not in ROLES:
            raise EvidenceError(f"Invalid role for {source_id}: {role!r}")
        if not isinstance(expected, str) or not SHA256.fullmatch(expected):
            raise EvidenceError(f"Invalid SHA-256 for {source_id}")
        materialized = relative_file(workspace_root, relative)
        canonical = str(materialized)
        if canonical in seen_paths:
            raise EvidenceError(f"Two source IDs point to the same file: {relative}")
        actual = file_sha256(materialized)
        if actual != expected:
            raise EvidenceError(f"Source SHA-256 mismatch: {source_id}")
        seen_ids.add(source_id)
        seen_paths.add(canonical)
        sources.append({**item, "_absolutePath": materialized})
    return manifest, sources
