"""Extract inspectable DOCX evidence without equating part counts with reading."""

from __future__ import annotations

import hashlib
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

from .common import EvidenceError, file_sha256, load_manifest, text_sha256, write_json


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
MAX_PART_BYTES = 64 * 1024 * 1024
MAX_PACKAGE_BYTES = 256 * 1024 * 1024


def _value(element: ET.Element, name: str) -> str | None:
    return element.get(W + name)


def _text(element: ET.Element, include_deleted: bool = False) -> str:
    chunks: list[str] = []
    for child in element.iter():
        if child.tag == W + "t" or (include_deleted and child.tag == W + "delText"):
            chunks.append(child.text or "")
        elif child.tag == W + "tab":
            chunks.append("\t")
        elif child.tag in {W + "br", W + "cr"}:
            chunks.append("\n")
    return "".join(chunks)


def _xml(book: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        return ET.fromstring(book.read(name))
    except (KeyError, ET.ParseError, RuntimeError, zipfile.BadZipFile) as exc:
        raise EvidenceError(f"Cannot parse DOCX part {name}: {exc}") from exc


def _part_inventory(book: zipfile.ZipFile) -> set[str]:
    infos = book.infolist()
    if any(info.file_size > MAX_PART_BYTES for info in infos):
        raise EvidenceError("DOCX contains an oversized package part")
    if sum(info.file_size for info in infos) > MAX_PACKAGE_BYTES:
        raise EvidenceError("DOCX expanded size exceeds the extraction limit")
    names = [info.filename for info in infos]
    if len(names) != len(set(names)):
        raise EvidenceError("DOCX contains duplicate package part names")
    return set(names)


def _tables(body: ET.Element) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for table_number, table in enumerate(body.iter(W + "tbl"), 1):
        rows = []
        for row_number, row in enumerate(table.findall(W + "tr"), 1):
            cells = []
            for cell_number, cell in enumerate(row.findall(W + "tc"), 1):
                span = cell.find(f"{W}tcPr/{W}gridSpan")
                merge = cell.find(f"{W}tcPr/{W}vMerge")
                cells.append(
                    {
                        "column": cell_number,
                        "text": "\n".join(_text(p) for p in cell.iter(W + "p")).strip(),
                        "gridSpan": int(_value(span, "val") or "1")
                        if span is not None
                        else 1,
                        "verticalMerge": (_value(merge, "val") or "continue")
                        if merge is not None
                        else None,
                    }
                )
            rows.append({"row": row_number, "cells": cells})
        tables.append({"table": table_number, "rows": rows})
    return tables


def _numbering(book: zipfile.ZipFile, names: set[str]) -> dict[str, Any]:
    if "word/numbering.xml" not in names:
        return {"abstractLevels": {}, "numberToAbstract": {}, "overrides": {}}
    root = _xml(book, "word/numbering.xml")
    abstract_levels = {}
    for abstract in root.findall(W + "abstractNum"):
        abstract_id = _value(abstract, "abstractNumId")
        levels = {}
        for level in abstract.findall(W + "lvl"):
            level_id = _value(level, "ilvl")
            levels[level_id] = {
                "start": _value(level.find(W + "start"), "val")
                if level.find(W + "start") is not None
                else None,
                "format": _value(level.find(W + "numFmt"), "val")
                if level.find(W + "numFmt") is not None
                else None,
                "pattern": _value(level.find(W + "lvlText"), "val")
                if level.find(W + "lvlText") is not None
                else None,
            }
        abstract_levels[abstract_id] = levels
    number_to_abstract = {}
    overrides = {}
    for number in root.findall(W + "num"):
        number_id = _value(number, "numId")
        abstract = number.find(W + "abstractNumId")
        number_to_abstract[number_id] = (
            _value(abstract, "val") if abstract is not None else None
        )
        for override in number.findall(W + "lvlOverride"):
            level_id = _value(override, "ilvl")
            start = override.find(W + "startOverride")
            level = override.find(W + "lvl")
            format_node = level.find(W + "numFmt") if level is not None else None
            pattern_node = level.find(W + "lvlText") if level is not None else None
            overrides.setdefault(number_id, {})[level_id] = {
                "start": _value(start, "val") if start is not None else None,
                "format": _value(format_node, "val")
                if format_node is not None
                else None,
                "pattern": _value(pattern_node, "val")
                if pattern_node is not None
                else None,
            }
    return {
        "abstractLevels": abstract_levels,
        "numberToAbstract": number_to_abstract,
        "overrides": overrides,
    }


def _styles(book: zipfile.ZipFile, names: set[str]) -> dict[str, Any]:
    if "word/styles.xml" not in names:
        return {}
    root = _xml(book, "word/styles.xml")
    result = {}
    for style in root.findall(W + "style"):
        style_id = _value(style, "styleId")
        if not style_id:
            continue
        name = style.find(W + "name")
        base = style.find(W + "basedOn")
        number = style.find(f"{W}pPr/{W}numPr/{W}numId")
        level = style.find(f"{W}pPr/{W}numPr/{W}ilvl")
        result[style_id] = {
            "name": _value(name, "val") if name is not None else None,
            "basedOn": _value(base, "val") if base is not None else None,
            "numId": _value(number, "val") if number is not None else None,
            "level": _value(level, "val") if level is not None else None,
        }
    return result


def _paragraph_numbering(
    paragraph: ET.Element, definitions: dict[str, Any], styles: dict[str, Any]
) -> dict[str, Any] | None:
    properties = paragraph.find(f"{W}pPr/{W}numPr")
    number = properties.find(W + "numId") if properties is not None else None
    level = properties.find(W + "ilvl") if properties is not None else None
    number_id = _value(number, "val") if number is not None else None
    level_id = _value(level, "val") if level is not None else None
    style = paragraph.find(f"{W}pPr/{W}pStyle")
    style_id = _value(style, "val") if style is not None else None
    visited: set[str] = set()
    while (
        style_id
        and style_id not in visited
        and style_id in styles
        and (number_id is None or level_id is None)
    ):
        visited.add(style_id)
        definition = styles[style_id]
        number_id = number_id or definition["numId"]
        level_id = level_id or definition["level"]
        style_id = definition["basedOn"]
    if number_id is None:
        return None
    level_id = level_id or "0"
    abstract_id = definitions["numberToAbstract"].get(number_id)
    base = definitions["abstractLevels"].get(abstract_id, {}).get(level_id) or {}
    override = definitions["overrides"].get(number_id, {}).get(level_id) or {}
    return {
        "numId": number_id,
        "level": level_id,
        "abstractNumId": abstract_id,
        "definition": {
            key: override.get(key) or base.get(key)
            for key in ("start", "format", "pattern")
        },
    }


def _read_docx(path: Path) -> tuple[dict[str, Any], str]:
    try:
        book = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise EvidenceError(f"Cannot open DOCX {path.name}: {exc}") from exc
    with book:
        names = _part_inventory(book)
        if "word/document.xml" not in names:
            raise EvidenceError("DOCX has no word/document.xml")
        document = _xml(book, "word/document.xml")
        body = document.find(W + "body")
        if body is None:
            raise EvidenceError("DOCX has no document body")

        numbering = _numbering(book, names)
        styles = _styles(book, names)
        paragraphs = [
            {
                "paragraph": number,
                "text": _text(paragraph),
                "style": _value(paragraph.find(f"{W}pPr/{W}pStyle"), "val")
                if paragraph.find(f"{W}pPr/{W}pStyle") is not None
                else None,
                "numbering": _paragraph_numbering(paragraph, numbering, styles),
            }
            for number, paragraph in enumerate(body.iter(W + "p"), 1)
        ]
        tables = _tables(body)

        head_parts = sorted(
            name
            for name in names
            if name.startswith("word/header") or name.startswith("word/footer")
        )
        headers_footers = [
            {
                "part": name,
                "text": "\n".join(
                    _text(p) for p in _xml(book, name).iter(W + "p")
                ).strip(),
            }
            for name in head_parts
            if name.endswith(".xml")
        ]

        anchors: dict[str, list[int]] = {}
        for number, paragraph in enumerate(body.iter(W + "p"), 1):
            for node in paragraph.iter():
                if node.tag in {W + "commentRangeStart", W + "commentReference"}:
                    comment_id = _value(node, "id")
                    if comment_id is not None:
                        anchors.setdefault(comment_id, []).append(number)
        comments = []
        if "word/comments.xml" in names:
            for comment in _xml(book, "word/comments.xml").iter(W + "comment"):
                comment_id = _value(comment, "id") or ""
                comments.append(
                    {
                        "id": comment_id,
                        "text": "\n".join(
                            _text(p) for p in comment.iter(W + "p")
                        ).strip(),
                        "paragraphs": sorted(set(anchors.get(comment_id, []))),
                        "author": _value(comment, "author"),
                        "date": _value(comment, "date"),
                    }
                )
        comment_metadata = []
        for name in sorted(names):
            if not (
                name.startswith("word/comments")
                and name.endswith(".xml")
                and name != "word/comments.xml"
            ):
                continue
            root = _xml(book, name)
            comment_metadata.append(
                {
                    "part": name,
                    "records": [
                        {
                            "kind": child.tag.split("}")[-1],
                            "attributes": {
                                key.split("}")[-1]: value
                                for key, value in child.attrib.items()
                            },
                            "text": "".join(child.itertext()).strip(),
                        }
                        for child in root
                    ],
                }
            )

        revisions = []
        for kind in ("ins", "del", "moveFrom", "moveTo"):
            for node in document.iter(W + kind):
                revisions.append(
                    {
                        "kind": kind,
                        "id": _value(node, "id"),
                        "text": _text(node, include_deleted=True),
                    }
                )

        fields = []
        for name in sorted(
            {"word/document.xml", *[item["part"] for item in headers_footers]}
        ):
            root = document if name == "word/document.xml" else _xml(book, name)
            for node in root.iter(W + "instrText"):
                fields.append({"part": name, "instruction": node.text or ""})
            for node in root.iter(W + "fldSimple"):
                fields.append(
                    {"part": name, "instruction": _value(node, "instr") or ""}
                )

        relationships = {}
        if "word/_rels/document.xml.rels" in names:
            for relation in _xml(book, "word/_rels/document.xml.rels"):
                relation_id = relation.get("Id")
                if relation_id:
                    relationships[relation_id] = {
                        "target": relation.get("Target"),
                        "type": relation.get("Type"),
                        "targetMode": relation.get("TargetMode"),
                    }
        hyperlinks = []
        for node in document.iter(W + "hyperlink"):
            relation_id = node.get(R + "id")
            hyperlinks.append(
                {
                    "text": _text(node),
                    "relationshipId": relation_id,
                    "anchor": _value(node, "anchor"),
                    "target": relationships.get(relation_id),
                }
            )

        media = [
            {"part": name, "sha256": hashlib.sha256(book.read(name)).hexdigest()}
            for name in sorted(names)
            if name.startswith("word/media/") and not name.endswith("/")
        ]
        embedded = [
            {"part": name, "sha256": hashlib.sha256(book.read(name)).hexdigest()}
            for name in sorted(names)
            if name.startswith("word/embeddings/") and not name.endswith("/")
        ]

        limits = []
        if media:
            limits.append(
                f"{len(media)} image/media part(s) inventoried but visual content not interpreted"
            )
        if embedded:
            limits.append(
                f"{len(embedded)} embedded object(s) inventoried but internal content not interpreted"
            )
        if any(not item["text"] for item in comments):
            limits.append("At least one DOCX comment has no extracted text")
        if any(not item["paragraphs"] for item in comments):
            limits.append("At least one DOCX comment has no body anchor")
        if any(
            record["text"] for part in comment_metadata for record in part["records"]
        ):
            limits.append("Extended comment metadata contains text requiring review")
        if anchors and len(anchors) != len({item["id"] for item in comments}):
            limits.append("At least one DOCX comment reference has no matching comment")
        if not any(item["text"].strip() for item in paragraphs):
            limits.append("No body text was extracted")
        if any(item["relationshipId"] and not item["target"] for item in hyperlinks):
            limits.append("At least one hyperlink target could not be resolved")

        evidence = {
            "format": "DOCX",
            "paragraphs": paragraphs,
            "numberingDefinitions": numbering,
            "styleDefinitions": styles,
            "tables": tables,
            "headersFooters": headers_footers,
            "comments": comments,
            "commentMetadata": comment_metadata,
            "revisions": revisions,
            "fields": fields,
            "hyperlinks": hyperlinks,
            "media": media,
            "embeddedObjects": embedded,
            "limitations": limits,
            "technicalReadCeiling": "PARTIAL" if limits else "READ",
        }

    lines = ["# Extracted DOCX evidence", "", "## Body", ""]
    for item in paragraphs:
        if item["text"].strip():
            prefix = f"[paragraph {item['paragraph']}; style={item['style']}; numbering={item['numbering']}] "
            lines.append(prefix + item["text"])
    lines.extend(["", "## Tables", ""])
    for table in tables:
        lines.append(f"### Table {table['table']}")
        for row in table["rows"]:
            lines.append(
                " | ".join(
                    f"{cell['text']} [span={cell['gridSpan']}, vertical={cell['verticalMerge'] or '-'}]"
                    for cell in row["cells"]
                )
            )
    lines.extend(["", "## Headers and footers", ""])
    lines.extend(f"[{item['part']}] {item['text']}" for item in headers_footers)
    lines.extend(["", "## Comments", ""])
    lines.extend(
        f"[comment {item['id']}, paragraphs {item['paragraphs']}] {item['text']}"
        for item in comments
    )
    for part in comment_metadata:
        lines.append(f"[{part['part']}] {part['records']}")
    lines.extend(["", "## Tracked revisions", ""])
    lines.extend(f"[{item['kind']} {item['id']}] {item['text']}" for item in revisions)
    lines.extend(["", "## Field instructions", ""])
    lines.extend(f"[{item['part']}] {item['instruction']}" for item in fields)
    lines.extend(["", "## Hyperlinks", ""])
    lines.extend(
        f"{item['text']} -> {item['target'] or item['anchor']}" for item in hyperlinks
    )
    lines.extend(["", "## Uninterpreted objects", ""])
    lines.extend(item["part"] for item in media + embedded)
    return evidence, "\n".join(lines).rstrip() + "\n"


def collect(
    manifest_path: Path, workspace_root: Path, output_dir: Path
) -> dict[str, Any]:
    """Write a source-bound, reproducible extraction snapshot to a new directory."""
    _, sources = load_manifest(manifest_path, workspace_root)
    manifest_sha = file_sha256(manifest_path)
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise EvidenceError(f"Extraction output already exists: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=".runner-evidence-", dir=output_dir.parent)
    )
    rows = []
    try:
        for source in sources:
            role = source["role"]
            source_id = source["sourceId"]
            path = source["_absolutePath"]
            stem = text_sha256(source_id)
            row: dict[str, Any] = {
                "sourceId": source_id,
                "role": role,
                "materializedRelativePath": source["materializedRelativePath"],
                "sourceSha256": source["sha256"],
                "extraction": None,
                "readable": None,
                "technicalReadCeiling": "NOT_APPLICABLE",
                "limitations": [],
                "counts": {},
            }
            if role in {"CUSTOMER_MATERIAL", "TEMPLATE"}:
                suffix = path.suffix.lower()
                try:
                    if suffix == ".docx":
                        evidence, readable = _read_docx(path)
                    elif suffix in {".md", ".txt"}:
                        readable = path.read_text(encoding="utf-8")
                        limits = [] if readable.strip() else ["Source text is empty"]
                        evidence = {
                            "format": "MARKDOWN" if suffix == ".md" else "TEXT",
                            "limitations": limits,
                            "technicalReadCeiling": "PARTIAL" if limits else "READ",
                        }
                    else:
                        evidence, readable = (
                            {
                                "format": suffix or "UNKNOWN",
                                "limitations": [
                                    "Unsupported input format for the MVP extractor"
                                ],
                                "technicalReadCeiling": "UNREAD",
                            },
                            "",
                        )
                except (EvidenceError, UnicodeError, OSError) as exc:
                    evidence, readable = (
                        {
                            "format": suffix or "UNKNOWN",
                            "limitations": [str(exc)],
                            "technicalReadCeiling": "FAILED",
                        },
                        "",
                    )
                extraction_path = temporary / f"{stem}.json"
                readable_path = temporary / f"{stem}.md"
                write_json(extraction_path, evidence)
                readable_path.write_text(readable, encoding="utf-8")
                row.update(
                    {
                        "extraction": {
                            "relativePath": extraction_path.name,
                            "sha256": file_sha256(extraction_path),
                        },
                        "readable": {
                            "relativePath": readable_path.name,
                            "sha256": file_sha256(readable_path),
                        },
                        "technicalReadCeiling": evidence["technicalReadCeiling"],
                        "limitations": evidence["limitations"],
                        "counts": {
                            "comments": len(evidence.get("comments", [])),
                            "commentTextExtracted": sum(
                                bool(comment["text"])
                                for comment in evidence.get("comments", [])
                            ),
                            "tables": len(evidence.get("tables", [])),
                            "media": len(evidence.get("media", [])),
                            "embeddedObjects": len(evidence.get("embeddedObjects", [])),
                        },
                    }
                )
            rows.append(row)
        index = {
            "formatVersion": "0.1.0",
            "inputManifestSha256": manifest_sha,
            "sources": rows,
        }
        write_json(temporary / "extraction-index.json", index)
        temporary.rename(output_dir)
        return index
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
