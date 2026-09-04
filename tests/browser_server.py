from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

from markdown_reader import ReaderConfig, create_app


ROOT_MARKER = Path("/tmp/markdown-reader-browser-root")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    temporary = Path(tempfile.mkdtemp(prefix="markdown-reader-browser-"))
    try:
        (temporary / "README.md").write_text(
            """# Browser Fixture

Editable paragraph.

## Method

Method text.

### Details

Nested detail.

## Results

Result text.
""",
            encoding="utf-8",
        )
        (temporary / "second.md").write_text("# Second\n\nAnother file.\n", encoding="utf-8")
        (temporary / "compat.md").write_text(
            """# Compatibility

Text with a footnote[^1].

[^1]: Footnote text.

| A | B |
| - | - |
| 1 | 2 |

$$
x^2 + y^2
$$

```mermaid
flowchart LR
  A --> B
```

<video controls src="./demo.mp4"></video>
""",
            encoding="utf-8",
        )
        shutil.copytree(
            Path(__file__).parent / "fixtures" / "markdown",
            temporary / "fixtures",
        )
        ROOT_MARKER.write_text(str(temporary), encoding="utf-8")
        app = create_app(
            ReaderConfig(temporary, temporary / "README.md"),
            state_file=temporary / "state.json",
        )
        app.run(
            host="127.0.0.1",
            port=args.port,
            debug=False,
            threaded=True,
            use_reloader=False,
        )
    finally:
        ROOT_MARKER.unlink(missing_ok=True)
        shutil.rmtree(temporary, ignore_errors=True)


if __name__ == "__main__":
    main()
