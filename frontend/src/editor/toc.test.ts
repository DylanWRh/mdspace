import { describe, expect, it } from "vitest";

import { extractEditorHeadings } from "./toc";

describe("extractEditorHeadings", () => {
  it("builds stable ids and ignores fenced source", () => {
    expect(
      extractEditorHeadings(`# **Intro**\n\n## Details\n\n\`\`\`md\n# Not a heading\n\`\`\`\n\n## Details\n`),
    ).toEqual([
      { level: 1, title: "Intro", id: "intro" },
      { level: 2, title: "Details", id: "details" },
      { level: 2, title: "Details", id: "details-1" },
    ]);
  });
});
