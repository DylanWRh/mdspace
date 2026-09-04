from __future__ import annotations

import argparse
import json
import mimetypes
import secrets
import subprocess
import sys
import threading
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import quote

from flask import Flask, abort, jsonify, render_template, request, send_file

from .assets import MAX_ASSET_BYTES, AssetTooLargeError, store_asset
from .documents import (
    MAX_MARKDOWN_BYTES,
    DocumentConflictError,
    document_source,
    save_document_source,
)
from .paths import MARKDOWN_SUFFIXES, safe_resolve
from .rendering import (
    DocumentRenderer,
    extract_title,
    make_markdown,
    preview_source,
    render_document,
)
from .workspace import (
    ReaderConfig,
    WorkspaceManager,
    browse_directory,
    default_workspace_state_file,
    empty_project_payload,
    find_initial_markdown,
    project_payload,
)


FRONTEND_MANIFEST = Path(__file__).parent / "static" / "dist" / "manifest.json"
_BROWSER_OPEN_SCRIPT = (
    "import sys, webbrowser; "
    "raise SystemExit(0 if webbrowser.open(sys.argv[1]) else 1)"
)


def frontend_assets() -> dict[str, Any]:
    """Return the compiled Vite entrypoints shipped with the Python package."""
    try:
        manifest = json.loads(FRONTEND_MANIFEST.read_text(encoding="utf-8"))
        entry = manifest["src/main.ts"]
        return {
            "script": f"dist/{entry['file']}",
            "styles": [f"dist/{path}" for path in entry.get("css", [])],
        }
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            "Compiled frontend assets are missing. Run `npm run build` in frontend/."
        ) from exc


def open_browser_quietly(url: str) -> bool:
    """Ask the platform browser launcher to open *url* without noisy probing."""
    try:
        completed = subprocess.run(
            [sys.executable, "-c", _BROWSER_OPEN_SCRIPT, url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return completed.returncode == 0


def schedule_browser_open(url: str) -> None:
    """Open the reader after startup without keeping the server process alive."""

    def launch() -> None:
        if not open_browser_quietly(url):
            print(
                "  Browser was not opened automatically. Use the URL above manually.",
                file=sys.stderr,
            )

    timer = threading.Timer(0.8, launch)
    timer.daemon = True
    timer.start()


def create_app(
    config: ReaderConfig | None,
    *,
    state_file: Path | None = None,
    browse_start: Path | None = None,
) -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    manager = WorkspaceManager(
        config,
        state_file=(
            state_file if state_file is not None else default_workspace_state_file()
        ),
        browse_start=browse_start,
    )
    switch_token = secrets.token_urlsafe(24)
    mutation_lock = RLock()
    app.config["WORKSPACE_MANAGER"] = manager
    app.config["WORKSPACE_SWITCH_TOKEN"] = switch_token
    app.config["MAX_CONTENT_LENGTH"] = MAX_ASSET_BYTES + 1024 * 1024

    @app.errorhandler(413)
    def request_too_large(_error):
        return jsonify({"error": "资源文件超过 100 MiB，无法插入。"}), 413

    def has_mutation_token() -> bool:
        return request.headers.get("X-Workspace-Token") == switch_token

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob: https: http:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "font-src 'self' data:; connect-src 'self'"
        )
        return response

    @app.get("/")
    def index():
        current = manager.current
        assets = frontend_assets()
        template_context = {
            "workspace_switch_token": switch_token,
            "frontend_assets": assets,
        }
        if not current:
            return render_template(
                "index.html",
                project_name="选择工作区",
                initial_file="",
                **template_context,
            )
        initial = current.initial_file.relative_to(current.root).as_posix()
        requested = request.args.get("file", initial)
        resolved = safe_resolve(current.root, requested)
        if (
            not resolved
            or not resolved.is_file()
            or resolved.suffix.lower() not in MARKDOWN_SUFFIXES
        ):
            requested = initial
        return render_template(
            "index.html",
            project_name=current.root.name,
            initial_file=requested,
            **template_context,
        )

    @app.get("/api/project")
    def project():
        current = manager.current
        return jsonify(
            project_payload(current) if current else empty_project_payload()
        )

    @app.get("/api/workspaces")
    def workspaces():
        return jsonify({"recent": manager.recent()})

    @app.get("/api/directories")
    def directories():
        if not has_mutation_token():
            abort(403)
        requested = request.args.get("path")
        target = Path(requested).expanduser() if requested else manager.browse_start()
        try:
            return jsonify(browse_directory(target))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @app.post("/api/workspace")
    def switch_workspace():
        if not has_mutation_token():
            abort(403)
        payload = request.get_json(silent=True) or {}
        directory = payload.get("path")
        if not isinstance(directory, str) or not directory.strip():
            return jsonify({"error": "请输入工作区目录。"}), 400
        try:
            with mutation_lock:
                selected = manager.switch(directory.strip())
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(
            {"project": project_payload(selected), "recent": manager.recent()}
        )

    @app.get("/api/document")
    def document():
        current = manager.current
        if not current:
            abort(409)
        try:
            return jsonify(render_document(current, request.args.get("path", "")))
        except (FileNotFoundError, OSError, UnicodeError):
            abort(404)

    @app.get("/api/source")
    def source():
        if not has_mutation_token():
            abort(403)
        current = manager.current
        if not current:
            abort(409)
        try:
            return jsonify(document_source(current, request.args.get("path", "")))
        except OverflowError:
            return jsonify(
                {"error": "Markdown 文件超过 5 MiB，无法在编辑器中打开。"}
            ), 413
        except (FileNotFoundError, OSError, UnicodeError):
            abort(404)

    @app.put("/api/source")
    def save_source():
        if not has_mutation_token():
            abort(403)
        payload = request.get_json(silent=True) or {}
        relative_path = payload.get("path")
        source_text = payload.get("source")
        expected_version = payload.get("version")
        expected_workspace = payload.get("workspace")
        values = (relative_path, source_text, expected_version, expected_workspace)
        if not all(isinstance(value, str) for value in values):
            return jsonify({"error": "保存请求缺少必要字段。"}), 400
        try:
            encoded_size = len(source_text.encode("utf-8"))
        except UnicodeError:
            return jsonify({"error": "Markdown 内容不是有效的 UTF-8 文本。"}), 400
        if encoded_size > MAX_MARKDOWN_BYTES:
            return jsonify(
                {"error": "Markdown 文件超过 5 MiB，无法在编辑器中保存。"}
            ), 413
        try:
            with mutation_lock:
                current = manager.current
                if not current:
                    return jsonify({"error": "请先选择工作区。"}), 409
                if expected_workspace != str(current.root):
                    return jsonify(
                        {"error": "工作区已切换，请重新打开文档后再编辑。"}
                    ), 409
                saved = save_document_source(
                    current, relative_path, source_text, expected_version
                )
                saved["document"] = render_document(current, relative_path)
                return jsonify(saved)
        except DocumentConflictError:
            return jsonify(
                {"error": "文件已被其他程序修改。请取消编辑并重新载入后再试。"}
            ), 409
        except OverflowError:
            return jsonify(
                {"error": "Markdown 文件超过 5 MiB，无法在编辑器中保存。"}
            ), 413
        except (FileNotFoundError, OSError, UnicodeError):
            abort(404)

    @app.post("/api/assets")
    def upload_asset():
        if not has_mutation_token():
            abort(403)
        current = manager.current
        if not current:
            abort(409)
        document_path = request.form.get("document", "")
        upload = request.files.get("file")
        if not document_path or not upload or not upload.filename:
            return jsonify({"error": "请选择要插入的本地文件。"}), 400
        try:
            with mutation_lock:
                return jsonify(
                    store_asset(
                        current,
                        document_path,
                        upload.filename,
                        upload.stream,
                        upload.mimetype,
                    )
                )
        except AssetTooLargeError:
            return jsonify({"error": "资源文件超过 100 MiB，无法插入。"}), 413
        except FileNotFoundError:
            return jsonify({"error": "目标 Markdown 文档不存在。"}), 404
        except (OSError, ValueError):
            return jsonify({"error": "无法安全地保存这个资源文件。"}), 400

    @app.get("/api/preview")
    def preview():
        current = manager.current
        if not current:
            abort(409)
        relative_path = request.args.get("path", "")
        anchor = request.args.get("anchor", "")
        target = safe_resolve(current.root, relative_path)
        if (
            not target
            or not target.is_file()
            or target.suffix.lower() not in MARKDOWN_SUFFIXES
        ):
            abort(404)
        try:
            source_text = target.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError):
            abort(404)
        excerpt = preview_source(source_text, anchor)
        renderer = DocumentRenderer(current.root, target)
        return jsonify(
            {
                "path": target.relative_to(current.root).as_posix(),
                "title": extract_title(
                    excerpt, extract_title(source_text, target.stem)
                ),
                "html": make_markdown(renderer).render(excerpt),
            }
        )

    @app.get("/api/raw")
    def raw_file():
        current = manager.current
        if not current:
            abort(409)
        target = safe_resolve(current.root, request.args.get("path", ""))
        if not target or not target.is_file():
            abort(404)
        guessed, _ = mimetypes.guess_type(target.name)
        return send_file(target, mimetype=guessed, conditional=True)

    return app


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="A focused, local-first Markdown reader with project navigation."
    )
    parser.add_argument(
        "directory",
        nargs="?",
        help="Project directory to read (omit to choose one in the browser)",
    )
    parser.add_argument(
        "--initial",
        metavar="FILE",
        help="Initial Markdown file relative to the project directory",
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="Listening host (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port", type=int, default=8765, help="Listening port (default: 8765)"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Do not open the browser automatically"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    config = None
    if args.directory:
        root = Path(args.directory).expanduser().resolve()
        if not root.is_dir():
            raise SystemExit(f"Project directory not found: {root}")
        try:
            initial_file = find_initial_markdown(root, args.initial)
        except (FileNotFoundError, ValueError) as exc:
            raise SystemExit(str(exc)) from exc
        config = ReaderConfig(root=root, initial_file=initial_file)
    elif args.initial:
        raise SystemExit("--initial requires a project directory")
    app = create_app(config, browse_start=Path.cwd())
    url = f"http://{args.host}:{args.port}/"
    if config:
        url += (
            f"?file={quote(config.initial_file.relative_to(config.root).as_posix(), safe='/')}"
        )
    print(f"\n  Markdown Reader  {url}")
    print(f"  Project root     {config.root if config else 'Choose in browser'}\n")
    if not args.no_browser:
        schedule_browser_open(url)
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
