import { describe, expect, it } from "vitest";

import {
  isPortableAttachment,
  parseControlledMediaHtml,
  parseControlledMediaStart,
} from "./media-preview";

describe("parseControlledMediaHtml", () => {
  it("recognizes the portable media HTML emitted by uploads", () => {
    expect(parseControlledMediaHtml('<video controls src="./assets/note/demo.mp4"></video>'))
      .toEqual({ kind: "video", source: "./assets/note/demo.mp4" });
    expect(parseControlledMediaHtml("<audio src='./voice.mp3' controls></audio>"))
      .toEqual({ kind: "audio", source: "./voice.mp3" });
    expect(parseControlledMediaStart('<video controls src="./demo.mp4">'))
      .toEqual({ kind: "video", source: "./demo.mp4" });
  });

  it("does not interpret unrelated or incomplete raw HTML", () => {
    expect(parseControlledMediaHtml("<details>text</details>")).toBeNull();
    expect(parseControlledMediaHtml("<video controls></video>")).toBeNull();
  });
});

describe("isPortableAttachment", () => {
  it("accepts uploaded asset links and rejects external URLs", () => {
    expect(isPortableAttachment("./assets/note/paper-a12.pdf")).toBe(true);
    expect(isPortableAttachment("../assets/note/data.csv?download=1")).toBe(true);
    expect(isPortableAttachment("https://example.com/paper.pdf")).toBe(false);
    expect(isPortableAttachment("#appendix")).toBe(false);
  });
});
