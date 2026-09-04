import { describe, expect, it } from "vitest";

import { assetMarkdown } from "./media";

describe("assetMarkdown", () => {
  const asset = {
    path: "notes/assets/idea/file-a.png",
    relativePath: "./assets/idea/file-a.png",
    mediaType: "image/png",
    name: "file-a.png",
    size: 4,
  } as const;

  it("keeps image paths portable", () => {
    expect(assetMarkdown({ ...asset, kind: "image" })).toBe(
      "![file-a.png](./assets/idea/file-a.png)",
    );
  });

  it("uses portable HTML for video and audio", () => {
    expect(assetMarkdown({ ...asset, kind: "video", mediaType: "video/mp4" })).toBe(
      '<video controls src="./assets/idea/file-a.png"></video>',
    );
    expect(assetMarkdown({ ...asset, kind: "audio", mediaType: "audio/mpeg" })).toBe(
      '<audio controls src="./assets/idea/file-a.png"></audio>',
    );
  });
});
