from __future__ import annotations

import html
import math
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit

from markdown_it import MarkdownIt
from markdown_it.renderer import RendererHTML
from markdown_it.rules_block import StateBlock
from markdown_it.rules_inline import StateInline
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.footnote import footnote_plugin
from mdit_py_plugins.tasklists import tasklists_plugin
from mdit_py_plugins.utils import is_code_block
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import TextLexer, get_lexer_by_name
from pygments.util import ClassNotFound

from .paths import (
    MARKDOWN_SUFFIXES,
    resolve_project_reference,
    safe_resolve,
)
from .workspace import ReaderConfig


EXTERNAL_SCHEMES = {"http", "https", "mailto", "tel", "ftp"}
HTML_ASSET_ATTRIBUTES = {
    "audio": {"src"},
    "embed": {"src"},
    "img": {"src"},
    "object": {"data"},
    "source": {"src"},
    "track": {"src"},
    "video": {"poster", "src"},
}


class DocumentRenderer(RendererHTML):
    """Markdown-it renderer with workspace-aware links and rich code blocks."""

    def __init__(self, root: Path, current_file: Path):
        super().__init__()
        self.root = root
        self.current_file = current_file
        self.slug_counts: dict[str, int] = {}
        self.headings: list[dict[str, Any]] = []

    @staticmethod
    def _slugify(value: str) -> str:
        value = re.sub(r"<[^>]+>", "", value)
        value = html.unescape(value).strip().lower()
        value = re.sub(r"[^\w\-\s\u4e00-\u9fff]", "", value, flags=re.UNICODE)
        value = re.sub(r"[\s_]+", "-", value).strip("-")
        return value or "section"

    def _unique_slug(self, value: str) -> str:
        base = self._slugify(value)
        count = self.slug_counts.get(base, 0)
        self.slug_counts[base] = count + 1
        return base if count == 0 else f"{base}-{count}"

    def heading_open(self, tokens, idx, options, env):
        token = tokens[idx]
        inline = tokens[idx + 1] if idx + 1 < len(tokens) else None
        title = (
            self.renderInlineAsText(inline.children or [], options, env).strip()
            if inline
            else ""
        )
        slug = self._unique_slug(title)
        token.attrSet("id", slug)
        token.attrJoin("class", "document-heading")
        self.headings.append(
            {"level": int(token.tag[1:]), "title": title, "id": slug}
        )
        return self.renderToken(tokens, idx, options, env)

    def fence(self, tokens, idx, options, env):
        token = tokens[idx]
        language = token.info.strip().split(maxsplit=1)[0] if token.info.strip() else ""
        if language.lower() == "mermaid":
            return (
                '<div class="diagram-shell" data-diagram-state="pending">'
                '<div class="diagram-label">Diagram</div>'
                f'<pre class="mermaid">{html.escape(token.content)}</pre>'
                "</div>"
            )

        try:
            lexer = get_lexer_by_name(language) if language else TextLexer()
        except ClassNotFound:
            lexer = TextLexer()
        formatted = highlight(
            token.content,
            lexer,
            HtmlFormatter(nowrap=True, cssclass="highlight"),
        )
        label = html.escape(language or "text")
        raw = html.escape(token.content, quote=True)
        return (
            '<div class="code-block">'
            f'<div class="code-toolbar"><span>{label}</span>'
            '<button class="copy-code" type="button" aria-label="Copy code">Copy</button></div>'
            f'<pre><code data-raw="{raw}">{formatted}</code></pre>'
            "</div>"
        )

    def image(self, tokens, idx, options, env):
        token = tokens[idx]
        src = token.attrGet("src") or ""
        resolved = resolve_project_reference(self.root, self.current_file, src)
        if resolved:
            token.attrSet("src", f"/api/raw?path={quote(resolved, safe='/')}")
            token.attrSet("data-source-path", resolved)
        token.attrSet("loading", "lazy")
        token.attrSet("decoding", "async")
        return super().image(tokens, idx, options, env)

    def html_block(self, tokens, idx, options, env):
        return rewrite_html_asset_references(
            self.root, self.current_file, tokens[idx].content
        )

    def html_inline(self, tokens, idx, options, env):
        return rewrite_html_asset_references(
            self.root, self.current_file, tokens[idx].content
        )

    def link_open(self, tokens, idx, options, env):
        token = tokens[idx]
        href = token.attrGet("href") or ""
        split = urlsplit(href)
        if split.scheme.lower() in EXTERNAL_SCHEMES or href.startswith("//"):
            token.attrSet("target", "_blank")
            token.attrSet("rel", "noopener noreferrer")
            token.attrJoin("class", "external-link")
        elif href.startswith("#"):
            token.attrJoin("class", "document-link anchor-link")
            token.attrSet("data-anchor", unquote(href[1:]))
        else:
            resolved = resolve_project_reference(self.root, self.current_file, href)
            if resolved:
                target = safe_resolve(self.root, resolved)
                if target and target.is_dir():
                    for name in ("README.md", "index.md"):
                        candidate = target / name
                        if candidate.is_file():
                            resolved = candidate.relative_to(self.root).as_posix()
                            target = candidate
                            break
                if target and target.suffix.lower() in MARKDOWN_SUFFIXES:
                    token.attrJoin("class", "document-link cross-document-link")
                    token.attrSet("data-doc-path", resolved)
                    token.attrSet("data-anchor", unquote(split.fragment))
                    token.attrSet(
                        "href",
                        f"/?file={quote(resolved, safe='/')}"
                        + (
                            f"#{quote(unquote(split.fragment))}"
                            if split.fragment
                            else ""
                        ),
                    )
                else:
                    token.attrJoin("class", "asset-link")
                    token.attrSet(
                        "href", f"/api/raw?path={quote(resolved, safe='/')}"
                    )
                    token.attrSet("target", "_blank")
        return self.renderToken(tokens, idx, options, env)


class LocalAssetHTMLRewriter(HTMLParser):
    """Rewrite local asset attributes in raw Markdown HTML to the file API."""

    def __init__(self, root: Path, current_file: Path) -> None:
        super().__init__(convert_charrefs=False)
        self.root = root
        self.current_file = current_file
        self.parts: list[str] = []

    def _start_tag(self, tag: str, attrs, self_closing: bool) -> None:
        allowed = HTML_ASSET_ATTRIBUTES.get(tag.lower())
        if not allowed:
            self.parts.append(self.get_starttag_text() or f"<{tag}>")
            return

        rewritten = []
        changed = False
        for name, value in attrs:
            if value is not None and name.lower() in allowed:
                resolved = resolve_project_reference(
                    self.root, self.current_file, value
                )
                if resolved:
                    value = f"/api/raw?path={quote(resolved, safe='/')}"
                    changed = True
            rewritten.append((name, value))

        if not changed:
            self.parts.append(self.get_starttag_text() or f"<{tag}>")
            return

        attributes = "".join(
            f" {name}"
            if value is None
            else f' {name}="{html.escape(value, quote=True)}"'
            for name, value in rewritten
        )
        ending = " />" if self_closing else ">"
        self.parts.append(f"<{tag}{attributes}{ending}")

    def handle_starttag(self, tag: str, attrs) -> None:
        self._start_tag(tag, attrs, False)

    def handle_startendtag(self, tag: str, attrs) -> None:
        self._start_tag(tag, attrs, True)

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def handle_pi(self, data: str) -> None:
        self.parts.append(f"<?{data}>")


def rewrite_html_asset_references(
    root: Path, current_file: Path, markup: str
) -> str:
    rewriter = LocalAssetHTMLRewriter(root, current_file)
    rewriter.feed(markup)
    rewriter.close()
    return "".join(rewriter.parts)


def backslash_math_plugin(md: MarkdownIt) -> None:
    """Parse MathJax's ``\\(...\\)`` and ``\\[...\\]`` delimiters.

    Markdown treats the delimiter backslashes as punctuation escapes by default,
    so MathJax cannot discover them after rendering. These rules consume the
    formulas before the standard escape rule while leaving code spans, fenced
    code, indented code, and escaped backslashes unchanged.
    """

    def math_inline_backslash(state: StateInline, silent: bool) -> bool:
        delimiters = (
            (r"\(", r"\)", "math_inline"),
            (r"\[", r"\]", "math_inline_display"),
        )
        for opening, closing, token_type in delimiters:
            if not state.src.startswith(opening, state.pos):
                continue
            end = state.src.find(closing, state.pos + len(opening))
            if end < 0 or end == state.pos + len(opening):
                return False
            if not silent:
                token = state.push(token_type, "math", 0)
                token.content = state.src[state.pos + len(opening) : end]
                token.markup = opening
            state.pos = end + len(closing)
            return True
        return False

    def math_block_backslash(
        state: StateBlock, start_line: int, end_line: int, silent: bool
    ) -> bool:
        if is_code_block(state, start_line):
            return False

        start = state.bMarks[start_line] + state.tShift[start_line]
        line_end = state.eMarks[start_line]
        if not state.src.startswith(r"\[", start):
            return False

        closing_line = start_line
        closing = state.src.find(r"\]", start + 2, line_end)
        if closing >= 0 and state.src[closing + 2 : line_end].strip():
            closing = -1

        while closing < 0:
            closing_line += 1
            if closing_line >= end_line:
                return False
            line_start = state.bMarks[closing_line] + state.tShift[closing_line]
            line_end = state.eMarks[closing_line]
            candidate = state.src.find(r"\]", line_start, line_end)
            if candidate >= 0 and not state.src[candidate + 2 : line_end].strip():
                closing = candidate

        if silent:
            return True

        state.line = closing_line + 1
        token = state.push("math_block", "math", 0)
        token.block = True
        token.content = state.src[start + 2 : closing]
        token.markup = r"\["
        token.map = [start_line, state.line]
        return True

    def render_math_inline_display(self, tokens, idx, options, env) -> str:
        content = html.escape(str(tokens[idx].content).strip())
        return f'<span class="math display">\\[{content}\\]</span>'

    md.inline.ruler.before("escape", "math_inline_backslash", math_inline_backslash)
    md.block.ruler.before("fence", "math_block_backslash", math_block_backslash)
    md.add_render_rule("math_inline_display", render_math_inline_display)


def make_markdown(renderer: RendererHTML) -> MarkdownIt:
    md = MarkdownIt(
        "commonmark",
        {"html": True, "linkify": True, "typographer": True},
        renderer_cls=lambda _parser: renderer,
    )
    md.enable(["table", "strikethrough"])
    md.use(footnote_plugin)
    md.use(tasklists_plugin, enabled=False, label=True)
    md.use(
        dollarmath_plugin,
        allow_space=True,
        allow_digits=True,
        renderer=lambda content, options: (
            f"\\[{html.escape(content)}\\]"
            if options["display_mode"]
            else f"\\({html.escape(content)}\\)"
        ),
    )
    md.use(backslash_math_plugin)
    return md


def extract_title(source: str, fallback: str) -> str:
    match = re.search(r"^#\s+(.+?)\s*$", source, flags=re.MULTILINE)
    return re.sub(r"[*_`\[\]]", "", match.group(1)).strip() if match else fallback


def reading_stats(source: str) -> dict[str, int]:
    cleaned = re.sub(r"```.*?```", " ", source, flags=re.DOTALL)
    cleaned = re.sub(r"<[^>]+>|https?://\S+|[#*_>`|\[\]()]", " ", cleaned)
    latin_words = len(re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*", cleaned))
    cjk_chars = len(re.findall(r"[\u3400-\u9fff]", cleaned))
    return {
        "words": latin_words + cjk_chars,
        "minutes": max(1, math.ceil(latin_words / 220 + cjk_chars / 450)),
    }


def render_document(config: ReaderConfig, relative_path: str) -> dict[str, Any]:
    target = safe_resolve(config.root, relative_path)
    if (
        not target
        or not target.is_file()
        or target.suffix.lower() not in MARKDOWN_SUFFIXES
    ):
        raise FileNotFoundError(relative_path)
    source = target.read_text(encoding="utf-8-sig")
    renderer = DocumentRenderer(config.root, target)
    rendered = make_markdown(renderer).render(source)
    stat = target.stat()
    return {
        "path": target.relative_to(config.root).as_posix(),
        "title": extract_title(source, target.stem.replace("-", " ").title()),
        "html": rendered,
        "toc": renderer.headings,
        "stats": reading_stats(source),
        "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
    }


def heading_slug(text: str) -> str:
    return DocumentRenderer._slugify(text)


def preview_source(source: str, anchor: str) -> str:
    lines = source.splitlines()
    if not anchor:
        return "\n".join(lines[:32])

    counts: dict[str, int] = {}
    start = None
    level = 7
    for index, line in enumerate(lines):
        match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if not match:
            continue
        base = heading_slug(match.group(2))
        count = counts.get(base, 0)
        counts[base] = count + 1
        slug = base if count == 0 else f"{base}-{count}"
        if slug == anchor or unquote(anchor) == match.group(2).strip():
            start = index
            level = len(match.group(1))
            break
    if start is None:
        return "\n".join(lines[:32])
    end = min(len(lines), start + 42)
    for index in range(start + 1, end):
        match = re.match(r"^(#{1,6})\s+", lines[index])
        if match and len(match.group(1)) <= level:
            end = index
            break
    return "\n".join(lines[start:end])
