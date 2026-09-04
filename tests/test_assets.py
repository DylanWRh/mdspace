from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from markdown_reader import ReaderConfig, create_app
from markdown_reader.assets import (
    MAX_ASSET_BYTES,
    classify_media,
    sanitize_filename_part,
)


class AssetApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "a").mkdir()
        (self.root / "b").mkdir()
        (self.root / "a" / "doc.md").write_text("# A\n", encoding="utf-8")
        (self.root / "b" / "doc.md").write_text("# B\n", encoding="utf-8")
        app = create_app(
            ReaderConfig(self.root, self.root / "a" / "doc.md"),
            state_file=self.root / "state.json",
        )
        app.testing = True
        self.token = app.config["WORKSPACE_SWITCH_TOKEN"]
        self.client = app.test_client()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def upload(
        self,
        document: str = "a/doc.md",
        name: str = "Figure 1.png",
        content: bytes = b"png-data",
        media_type: str = "image/png",
    ):
        return self.client.post(
            "/api/assets",
            headers={"X-Workspace-Token": self.token},
            data={
                "document": document,
                "file": (io.BytesIO(content), name, media_type),
            },
        )

    def test_valid_image_upload_is_document_relative(self) -> None:
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["kind"], "image")
        self.assertTrue(payload["path"].startswith("a/assets/doc/Figure-1-"))
        self.assertTrue(payload["relativePath"].startswith("./assets/doc/Figure-1-"))
        self.assertEqual((self.root / payload["path"]).read_bytes(), b"png-data")

    def test_upload_requires_workspace_token(self) -> None:
        response = self.client.post(
            "/api/assets",
            data={
                "document": "a/doc.md",
                "file": (io.BytesIO(b"x"), "x.png", "image/png"),
            },
        )
        self.assertEqual(response.status_code, 403)

    def test_document_traversal_and_absolute_paths_are_rejected(self) -> None:
        self.assertEqual(self.upload(document="../outside.md").status_code, 404)
        self.assertEqual(self.upload(document="/etc/passwd").status_code, 404)

    def test_distinct_same_named_files_do_not_overwrite(self) -> None:
        first = self.upload(content=b"first").get_json()
        second = self.upload(content=b"second").get_json()
        self.assertNotEqual(first["path"], second["path"])
        self.assertEqual((self.root / first["path"]).read_bytes(), b"first")
        self.assertEqual((self.root / second["path"]).read_bytes(), b"second")

    def test_duplicate_content_reuses_deterministic_path(self) -> None:
        first = self.upload().get_json()
        second = self.upload().get_json()
        self.assertEqual(first["path"], second["path"])

    def test_documents_in_different_directories_get_separate_assets(self) -> None:
        first = self.upload(document="a/doc.md").get_json()
        second = self.upload(document="b/doc.md").get_json()
        self.assertTrue(first["path"].startswith("a/assets/doc/"))
        self.assertTrue(second["path"].startswith("b/assets/doc/"))

    def test_supported_media_classes(self) -> None:
        samples = [
            ("x.png", "image/png", "image"),
            ("x.jpg", "image/jpeg", "image"),
            ("x.svg", "image/svg+xml", "image"),
            ("x.mp4", "video/mp4", "video"),
            ("x.mp3", "audio/mpeg", "audio"),
            ("x.pdf", "application/pdf", "pdf"),
        ]
        for name, media_type, expected in samples:
            with self.subTest(name=name):
                payload = self.upload(name=name, media_type=media_type).get_json()
                self.assertEqual(payload["kind"], expected)

    def test_windows_unsafe_names_are_sanitized(self) -> None:
        payload = self.upload(name='CON<>:"/\\|?*.png').get_json()
        self.assertNotRegex(payload["name"], r'[<>:"/\\|?*]')
        self.assertTrue(payload["name"].endswith(".png"))

    def test_asset_directory_symlink_cannot_escape_workspace(self) -> None:
        outside = self.root.parent / f"{self.root.name}-outside-assets"
        outside.mkdir()
        self.addCleanup(lambda: outside.rmdir() if outside.exists() else None)
        (self.root / "a" / "assets").symlink_to(outside, target_is_directory=True)

        response = self.upload()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(outside.iterdir()), [])

    def test_upload_limit_is_100_mib_and_partial_file_is_cleaned_up(self) -> None:
        self.assertEqual(MAX_ASSET_BYTES, 100 * 1024 * 1024)
        with patch("markdown_reader.assets.MAX_ASSET_BYTES", 8):
            response = self.upload(content=b"123456789")

        self.assertEqual(response.status_code, 413)
        asset_directory = self.root / "a" / "assets" / "doc"
        self.assertEqual(list(asset_directory.glob(".upload-*.tmp")), [])
        self.assertEqual(list(asset_directory.glob("Figure-1-*")), [])


class AssetHelpersTestCase(unittest.TestCase):
    def test_reserved_windows_names_are_prefixed(self) -> None:
        self.assertEqual(sanitize_filename_part("CON", fallback="asset"), "_CON")

    def test_media_fallback(self) -> None:
        self.assertEqual(classify_media("text/csv", ".csv"), "file")


if __name__ == "__main__":
    unittest.main()
