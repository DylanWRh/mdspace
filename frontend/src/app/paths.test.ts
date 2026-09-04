import { describe, expect, it } from "vitest";

import { documentRelativePath, rawAssetUrl } from "./paths";

describe("document asset paths", () => {
  it("resolves document-relative portable Markdown paths", () => {
    expect(documentRelativePath("notes/idea.md", "./assets/idea/figure.png")).toBe(
      "notes/assets/idea/figure.png",
    );
    expect(documentRelativePath("notes/idea.md", "../shared/figure.png")).toBe(
      "shared/figure.png",
    );
  });

  it("uses the raw API only for DOM rendering", () => {
    expect(rawAssetUrl("notes/idea.md", "./assets/idea/figure.png")).toBe(
      "/api/raw?path=notes/assets/idea/figure.png",
    );
    expect(rawAssetUrl("notes/idea.md", "https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
  });
});
