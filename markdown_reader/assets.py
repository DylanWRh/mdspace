from __future__ import annotations

import hashlib
import mimetypes
import re
import secrets
import unicodedata
from pathlib import Path
from typing import BinaryIO, Any

from .paths import MARKDOWN_SUFFIXES, safe_resolve
from .workspace import ReaderConfig


MAX_ASSET_BYTES = 100 * 1024 * 1024
HASH_CHUNK_BYTES = 1024 * 1024
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


class AssetTooLargeError(OverflowError):
    """Raised when an uploaded asset exceeds the configured size limit."""


def store_asset(
    config: ReaderConfig,
    document_path: str,
    filename: str,
    stream: BinaryIO,
    declared_media_type: str | None = None,
) -> dict[str, Any]:
    """Stream an upload into a deterministic, document-local asset directory."""
    document = safe_resolve(config.root, document_path)
    if (
        not document
        or not document.is_file()
        or document.suffix.lower() not in MARKDOWN_SUFFIXES
    ):
        raise FileNotFoundError(document_path)

    original_name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    original = Path(original_name or "asset")
    stem = sanitize_filename_part(original.stem, fallback="asset")
    extension = sanitize_extension(original.suffix)
    if not extension and declared_media_type:
        extension = sanitize_extension(
            mimetypes.guess_extension(declared_media_type, strict=False) or ""
        )
    document_stem = sanitize_filename_part(document.stem, fallback="document")
    asset_directory = _safe_asset_directory(config.root, document.parent, document_stem)

    temporary = asset_directory / f".upload-{secrets.token_hex(12)}.tmp"
    digest = hashlib.sha256()
    size = 0
    try:
        with temporary.open("xb") as target:
            while True:
                chunk = stream.read(HASH_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ASSET_BYTES:
                    raise AssetTooLargeError(filename)
                digest.update(chunk)
                target.write(chunk)

        hash_value = digest.hexdigest()
        destination = _collision_safe_destination(
            asset_directory, stem, extension, hash_value
        )
        if destination.exists():
            temporary.unlink()
        else:
            temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)

    media_type = _media_type(destination, declared_media_type)
    workspace_path = destination.relative_to(config.root).as_posix()
    document_relative = destination.relative_to(document.parent).as_posix()
    return {
        "path": workspace_path,
        "relativePath": f"./{document_relative}",
        "kind": classify_media(media_type, destination.suffix),
        "mediaType": media_type,
        "name": destination.name,
        "size": size,
    }


def sanitize_filename_part(value: str, *, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = re.sub(r"[\x00-\x1f<>:\"/\\|?*]+", "-", normalized)
    normalized = re.sub(r"\s+", "-", normalized)
    normalized = re.sub(r"-+", "-", normalized).strip(" .-")
    normalized = normalized[:80].rstrip(" .-") or fallback
    if normalized.upper() in WINDOWS_RESERVED_NAMES:
        normalized = f"_{normalized}"
    return normalized


def sanitize_extension(extension: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", extension.lstrip("."))[:12].lower()
    return f".{cleaned}" if cleaned else ""


def classify_media(media_type: str, extension: str) -> str:
    if media_type.startswith("image/"):
        return "image"
    if media_type.startswith("video/"):
        return "video"
    if media_type.startswith("audio/"):
        return "audio"
    if media_type == "application/pdf" or extension.lower() == ".pdf":
        return "pdf"
    return "file"


def _media_type(path: Path, declared: str | None) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    if declared and re.match(r"^[\w.+-]+/[\w.+-]+$", declared):
        return declared
    return "application/octet-stream"


def _safe_asset_directory(
    workspace_root: Path, document_directory: Path, document_stem: str
) -> Path:
    workspace_root = workspace_root.resolve()
    document_directory = document_directory.resolve()
    document_directory.relative_to(workspace_root)

    assets_root = document_directory / "assets"
    if assets_root.exists() or assets_root.is_symlink():
        resolved_assets_root = assets_root.resolve()
        resolved_assets_root.relative_to(workspace_root)
    else:
        assets_root.mkdir()
        resolved_assets_root = assets_root.resolve()
        resolved_assets_root.relative_to(workspace_root)

    asset_directory = resolved_assets_root / document_stem
    if asset_directory.exists() or asset_directory.is_symlink():
        resolved_directory = asset_directory.resolve()
        resolved_directory.relative_to(workspace_root)
    else:
        asset_directory.mkdir()
        resolved_directory = asset_directory.resolve()
        resolved_directory.relative_to(workspace_root)
    return resolved_directory


def _collision_safe_destination(
    directory: Path, stem: str, extension: str, digest: str
) -> Path:
    for length in (8, 12, 16, 64):
        candidate = directory / f"{stem}-{digest[:length]}{extension}"
        if not candidate.exists() or _file_digest(candidate) == digest:
            return candidate
    raise FileExistsError(f"Unable to allocate asset name for {stem}{extension}")


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(HASH_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()
