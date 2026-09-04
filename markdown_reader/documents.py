from __future__ import annotations

import codecs
import hashlib
import secrets
from pathlib import Path
from typing import Any

from .paths import MARKDOWN_SUFFIXES, safe_resolve
from .workspace import ReaderConfig


MAX_MARKDOWN_BYTES = 5 * 1024 * 1024


class DocumentConflictError(RuntimeError):
    """Raised when a document changed after the editor loaded it."""


def document_source(config: ReaderConfig, relative_path: str) -> dict[str, Any]:
    """Read editable Markdown source and return a content-based version token."""
    target = _editable_document(config, relative_path)
    raw = target.read_bytes()
    if len(raw) > MAX_MARKDOWN_BYTES:
        raise OverflowError(relative_path)
    return {
        "path": target.relative_to(config.root).as_posix(),
        "source": raw.decode("utf-8-sig"),
        "version": hashlib.sha256(raw).hexdigest(),
        "workspace": str(config.root),
    }


def save_document_source(
    config: ReaderConfig,
    relative_path: str,
    source: str,
    expected_version: str,
) -> dict[str, Any]:
    """Atomically save Markdown if its current version still matches."""
    target = _editable_document(config, relative_path)
    current = target.read_bytes()
    if _version(current) != expected_version:
        raise DocumentConflictError(relative_path)

    encoded = source.encode("utf-8")
    if current.startswith(codecs.BOM_UTF8):
        encoded = codecs.BOM_UTF8 + encoded
    if len(encoded) > MAX_MARKDOWN_BYTES:
        raise OverflowError(relative_path)

    temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")
    try:
        temporary.write_bytes(encoded)
        temporary.chmod(target.stat().st_mode)
        if _version(target.read_bytes()) != expected_version:
            raise DocumentConflictError(relative_path)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return document_source(config, relative_path)


def _editable_document(config: ReaderConfig, relative_path: str) -> Path:
    target = safe_resolve(config.root, relative_path)
    if (
        not target
        or not target.is_file()
        or target.suffix.lower() not in MARKDOWN_SUFFIXES
    ):
        raise FileNotFoundError(relative_path)
    return target


def _version(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
