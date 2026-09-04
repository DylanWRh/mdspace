from __future__ import annotations

import ctypes
import json
import os
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any

from .paths import MARKDOWN_SUFFIXES, safe_resolve


IGNORED_DIRECTORIES = {
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
}


@dataclass(frozen=True)
class ReaderConfig:
    root: Path
    initial_file: Path


def default_workspace_state_file() -> Path:
    """Return the per-user file used to remember recently opened workspaces."""
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        base = Path(os.environ["LOCALAPPDATA"])
    else:
        base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    return base / "markdown-reader" / "workspaces.json"


class WorkspaceManager:
    """Own the active project root and a small persistent recent-workspace list."""

    def __init__(
        self,
        config: ReaderConfig | None,
        state_file: Path | None = None,
        max_recent: int = 8,
        browse_start: Path | None = None,
    ) -> None:
        self._lock = RLock()
        self._config = (
            ReaderConfig(config.root.resolve(), config.initial_file.resolve())
            if config
            else None
        )
        self._state_file = state_file
        self._max_recent = max_recent
        self._browse_start = (browse_start or Path.cwd()).resolve()
        self._recent = self._load_recent()
        if self._config:
            self._remember(self._config.root)

    @property
    def current(self) -> ReaderConfig | None:
        with self._lock:
            return self._config

    def switch(self, directory: str | Path) -> ReaderConfig:
        root = Path(directory).expanduser().resolve()
        if not root.is_dir():
            raise ValueError(f"Workspace directory not found: {root}")
        try:
            initial_file = find_initial_markdown(root)
        except FileNotFoundError as exc:
            raise ValueError(str(exc)) from exc
        with self._lock:
            self._config = ReaderConfig(root=root, initial_file=initial_file)
            self._remember(root)
            return self._config

    def recent(self) -> list[dict[str, Any]]:
        with self._lock:
            current = self._config.root if self._config else None
            return [
                {
                    "name": root.name or str(root),
                    "path": str(root),
                    "available": root.is_dir(),
                    "current": root == current,
                }
                for root in (Path(value) for value in self._recent)
            ]

    def browse_start(self) -> Path:
        with self._lock:
            if self._config:
                return self._config.root
            for value in self._recent:
                candidate = Path(value)
                if candidate.is_dir():
                    return candidate
            return self._browse_start

    def _remember(self, root: Path) -> None:
        value = str(root)
        self._recent = [value, *(item for item in self._recent if item != value)][
            : self._max_recent
        ]
        self._save_recent()

    def _load_recent(self) -> list[str]:
        if not self._state_file or not self._state_file.is_file():
            return []
        try:
            payload = json.loads(self._state_file.read_text(encoding="utf-8"))
            values = payload.get("recent", [])
            return [str(Path(value).expanduser().resolve()) for value in values if value]
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return []

    def _save_recent(self) -> None:
        if not self._state_file:
            return
        try:
            self._state_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = self._state_file.with_suffix(".tmp")
            temporary.write_text(
                json.dumps({"recent": self._recent}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(self._state_file)
        except OSError:
            pass


def build_tree(root: Path, directory: Path | None = None) -> list[dict[str, Any]]:
    directory = directory or root
    nodes: list[dict[str, Any]] = []
    try:
        children = sorted(
            directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
        )
    except OSError:
        return nodes
    for child in children:
        if child.name.startswith(".") or child.name in IGNORED_DIRECTORIES:
            continue
        try:
            relative = child.relative_to(root).as_posix()
            if child.is_dir():
                descendants = build_tree(root, child)
                if descendants:
                    nodes.append(
                        {
                            "name": child.name,
                            "path": relative,
                            "type": "folder",
                            "children": descendants,
                        }
                    )
            elif child.is_file():
                nodes.append(
                    {
                        "name": child.name,
                        "path": relative,
                        "type": (
                            "markdown"
                            if child.suffix.lower() in MARKDOWN_SUFFIXES
                            else "file"
                        ),
                        "extension": child.suffix.lower().lstrip("."),
                    }
                )
        except OSError:
            continue
    return nodes


def find_initial_markdown(root: Path, requested: str | None = None) -> Path:
    """Choose the first document shown for a project directory."""
    if requested:
        candidate = safe_resolve(root, requested)
        if (
            not candidate
            or not candidate.is_file()
            or candidate.suffix.lower() not in MARKDOWN_SUFFIXES
        ):
            raise ValueError(
                f"Initial Markdown file not found inside the project: {requested}"
            )
        return candidate

    for name in ("README.md", "README.markdown", "index.md", "INDEX.md"):
        candidate = root / name
        if candidate.is_file():
            return candidate.resolve()

    documents: list[Path] = []
    for current, directories, files in os.walk(root):
        directories[:] = sorted(
            (
                name
                for name in directories
                if not name.startswith(".") and name not in IGNORED_DIRECTORIES
            ),
            key=str.lower,
        )
        for name in sorted(files, key=str.lower):
            candidate = Path(current) / name
            if candidate.suffix.lower() in MARKDOWN_SUFFIXES:
                documents.append(candidate.resolve())
    documents.sort(key=lambda path: path.relative_to(root).as_posix().lower())
    if not documents:
        raise FileNotFoundError(f"No Markdown files found in directory: {root}")
    return documents[0]


def project_payload(config: ReaderConfig) -> dict[str, Any]:
    return {
        "name": config.root.name or str(config.root),
        "root": str(config.root),
        "initialFile": config.initial_file.relative_to(config.root).as_posix(),
        "tree": build_tree(config.root),
        "initialized": True,
    }


def empty_project_payload() -> dict[str, Any]:
    return {
        "name": "选择工作区",
        "root": "",
        "initialFile": "",
        "tree": [],
        "initialized": False,
    }


def list_windows_drives() -> list[dict[str, str]]:
    if os.name != "nt":
        return []
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    return [
        {"name": f"{chr(65 + index)}:", "path": f"{chr(65 + index)}:\\"}
        for index in range(26)
        if bitmask & (1 << index)
    ]


def browse_directory(path: Path) -> dict[str, Any]:
    root = path.expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Directory not found: {root}")
    try:
        directories = [
            {"name": child.name, "path": str(child)}
            for child in sorted(
                (
                    child
                    for child in root.iterdir()
                    if child.is_dir() and not child.name.startswith(".")
                ),
                key=lambda child: child.name.lower(),
            )
        ]
    except (OSError, PermissionError) as exc:
        raise ValueError(f"Cannot access directory: {root}") from exc
    try:
        has_markdown = any(
            child.is_file() and child.suffix.lower() in MARKDOWN_SUFFIXES
            for child in root.iterdir()
        )
    except (OSError, PermissionError):
        has_markdown = False
    parent = None if root.parent == root else str(root.parent)
    return {
        "path": str(root),
        "parent": parent,
        "directories": directories,
        "drives": list_windows_drives() if parent is None else [],
        "hasMarkdown": has_markdown,
    }
