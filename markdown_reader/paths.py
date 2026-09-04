from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


MARKDOWN_SUFFIXES = {".md", ".markdown", ".mdown", ".mkd"}


def safe_resolve(root: Path, relative_path: str | Path) -> Path | None:
    """Resolve a user-provided path while keeping it inside the workspace."""
    try:
        candidate = (root / Path(str(relative_path))).resolve()
        candidate.relative_to(root.resolve())
        return candidate
    except (OSError, ValueError):
        return None


def resolve_project_reference(
    root: Path, current_file: Path, href: str
) -> str | None:
    """Resolve a Markdown reference to a workspace-relative POSIX path."""
    split = urlsplit(href)
    if split.scheme or href.startswith("//") or href.startswith("#"):
        return None
    path_part = unquote(split.path).replace("\\", "/")
    if not path_part:
        return current_file.relative_to(root).as_posix()
    try:
        target = (current_file.parent / PurePosixPath(path_part)).resolve()
        target.relative_to(root.resolve())
        return target.relative_to(root.resolve()).as_posix()
    except (OSError, ValueError):
        return None
