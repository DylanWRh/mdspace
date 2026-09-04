from __future__ import annotations

import codecs
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from markdown_reader.documents import (
    DocumentConflictError,
    document_source,
    save_document_source,
)
from markdown_reader.workspace import ReaderConfig


class DocumentStorageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.document = self.root / "README.md"
        self.document.write_bytes(b"# Original\n")
        self.config = ReaderConfig(self.root, self.document)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_utf8_bom_is_hidden_from_editor_and_preserved_on_save(self) -> None:
        original = codecs.BOM_UTF8 + "# BOM document\n".encode()
        self.document.write_bytes(original)

        loaded = document_source(self.config, "README.md")
        self.assertEqual(loaded["source"], "# BOM document\n")
        self.assertEqual(loaded["version"], hashlib.sha256(original).hexdigest())

        saved = save_document_source(
            self.config,
            "README.md",
            "# Updated BOM document\n",
            loaded["version"],
        )

        self.assertTrue(self.document.read_bytes().startswith(codecs.BOM_UTF8))
        self.assertEqual(saved["source"], "# Updated BOM document\n")

    def test_document_source_rejects_markdown_above_the_size_limit(self) -> None:
        self.document.write_bytes(b"123456789")
        with patch("markdown_reader.documents.MAX_MARKDOWN_BYTES", 8):
            with self.assertRaises(OverflowError):
                document_source(self.config, "README.md")

    def test_oversized_save_leaves_original_and_no_temporary_file(self) -> None:
        original = self.document.read_bytes()
        version = hashlib.sha256(original).hexdigest()
        with patch("markdown_reader.documents.MAX_MARKDOWN_BYTES", 8):
            with self.assertRaises(OverflowError):
                save_document_source(
                    self.config,
                    "README.md",
                    "123456789",
                    version,
                )

        self.assertEqual(self.document.read_bytes(), original)
        self.assertEqual(self._temporary_files(), [])

    def test_conflict_after_temporary_write_cleans_up_without_replacing(self) -> None:
        original = self.document.read_bytes()
        version = hashlib.sha256(original).hexdigest()
        with patch(
            "markdown_reader.documents._version",
            side_effect=[version, "externally-changed"],
        ):
            with self.assertRaises(DocumentConflictError):
                save_document_source(
                    self.config,
                    "README.md",
                    "# Local update\n",
                    version,
                )

        self.assertEqual(self.document.read_bytes(), original)
        self.assertEqual(self._temporary_files(), [])

    def _temporary_files(self) -> list[Path]:
        return list(self.root.glob(".README.md.*.tmp"))


if __name__ == "__main__":
    unittest.main()
