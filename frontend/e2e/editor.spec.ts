import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = () => readFileSync("/tmp/markdown-reader-browser-root", "utf8").trim();
const readmePath = () => join(workspaceRoot(), "README.md");

const roundTripCases: Record<string, string[]> = {
  "basic.md": ["# Basic Document", "portable link", "Another paragraph"],
  "headings.md": ["# Heading One", "###### Heading Six"],
  "emphasis.md": ["**bold text**", "*italic text*", "~~struck text~~", "`inline code`"],
  "nested-lists.md": ["Parent item", "Child item", "Ordered grandchild"],
  "task-lists.md": ["[x] Completed task", "[ ] Open task", "[ ] Nested task"],
  "links.md": ["https://example.com", "./basic.md#basic-document", "https://example.org"],
  "local-images.md": ["![Experiment chart]", "./assets/example/chart.png"],
  "tables.md": ["| Name", "Alpha", "Beta"],
  "code.md": ["```python", "def answer() -> int:", "return 42"],
  "math.md": ["$x^2 + y^2$", "$$", "\\frac{1}{3}"],
  "mermaid.md": ["```mermaid", "flowchart LR", "B --> C"],
  "footnotes.md": ["[^paper]", "A portable footnote"],
  "raw-html.md": ["<details>", "<summary>Expandable source</summary>", "</details>"],
  "media-html.md": ["<video controls", "demo.mp4", "<audio controls", "voice.mp3"],
  "mixed-document.md": ["[x] Rich editing", "| Item", "```mermaid", "[^mixed]"],
};

test.beforeEach(async ({ page }) => {
  writeFileSync(
    readmePath(),
    "# Browser Fixture\n\nEditable paragraph.\n\n## Method\n\nMethod text.\n\n### Details\n\nNested detail.\n\n## Results\n\nResult text.\n",
  );
  await page.goto("/");
  await expect(page.locator("#documentContent h1")).toHaveText("Browser Fixture");
});

test("edits rich content, autosaves, and returns to read mode", async ({ page }) => {
  await page.locator("#editMode").click();
  const editor = page.locator(".rich-editor .ProseMirror");
  await expect(editor).toBeVisible();
  await expect(page.locator("#sourceEditor")).toBeHidden();

  const paragraph = editor.locator("p").filter({ hasText: "Editable paragraph." }).first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Updated.");
  await expect(page.locator("#editorState")).toHaveText("有未保存更改");
  await expect(page.locator("#editorState")).toHaveText("已保存", { timeout: 10_000 });

  await page.locator("#readMode").click();
  await expect(page.locator("#documentContent")).toContainText("Editable paragraph. Updated.");
  expect(readFileSync(readmePath(), "utf8")).toContain("Editable paragraph. Updated.");
});

test("switches between rich and source without saving as a side effect", async ({ page }) => {
  await page.locator("#editMode").click();
  await expect(page.locator(".rich-editor .ProseMirror")).toBeVisible();
  await page.locator("#sourceEditorMode").click();
  const source = page.locator("#sourceEditor");
  await expect(source).toBeVisible();
  const original = await source.inputValue();
  await source.fill(`${original}\n## Added in source\n\nSource body.\n`);
  await page.locator("#richEditorMode").click();
  await expect(page.locator(".rich-editor .ProseMirror h2").filter({ hasText: "Added in source" })).toBeVisible();
});

test("uploads an image and persists only a relative Markdown path", async ({ page }) => {
  await page.locator("#editMode").click();
  await page.locator("#insertAsset").click();
  await page.locator("#assetInput").setInputFiles({
    name: "figure.png",
    mimeType: "image/png",
    buffer: Buffer.from("browser-image"),
  });
  await expect(
    page.locator(".rich-editor .ProseMirror img:not(.ProseMirror-separator)"),
  ).toBeVisible();
  await expect(page.locator("#editorState")).toHaveText("已保存", { timeout: 10_000 });
  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown).toContain("./assets/README/figure-");
  expect(markdown).not.toContain("/api/raw");
  expect(markdown).not.toContain("data:image");
});

test("shows a conflict without overwriting an external edit", async ({ page }) => {
  await page.locator("#editMode").click();
  const paragraph = page.locator(".rich-editor .ProseMirror p").filter({ hasText: "Editable paragraph." }).first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Local edit");
  writeFileSync(readmePath(), "# Changed externally\n\nExternal content wins.\n");

  await expect(page.locator("#conflictBanner")).toBeVisible({ timeout: 10_000 });
  expect(readFileSync(readmePath(), "utf8")).toBe("# Changed externally\n\nExternal content wins.\n");
  await expect(page.locator(".rich-editor .ProseMirror")).toContainText("Local edit");
});

test("does not silently lose extended Markdown during rich to source conversion", async ({ page }) => {
  await page.goto("/?file=compat.md");
  await expect(page.locator("#documentContent h1")).toHaveText("Compatibility");
  await page.locator("#editMode").click();
  await expect(page.locator(".rich-editor .media-html-node video[controls]")).toBeVisible();
  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown).toContain("[^1]");
  expect(markdown).toContain("[^1]: Footnote text.");
  expect(markdown).toContain("| A | B |");
  expect(markdown).toContain("$$");
  expect(markdown).toContain("```mermaid");
  expect(markdown).toContain('<video controls src="./demo.mp4"></video>');
});

test("drags a heading together with its complete section", async ({ page }) => {
  await page.locator("#editMode").click();
  const method = page.getByRole("button", { name: "Move section: Method" });
  const results = page.getByRole("button", { name: "Move section: Results" });
  await expect(method).toBeAttached();
  await expect(results).toBeAttached();
  await results.dragTo(method);

  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown.indexOf("## Results")).toBeLessThan(markdown.indexOf("## Method"));
  expect(markdown.indexOf("Result text.")).toBeLessThan(markdown.indexOf("## Method"));
});

test("creates a Mermaid fence from the dedicated slash command", async ({ page }) => {
  await page.locator("#editMode").click();
  const result = page.locator(".rich-editor .ProseMirror p").filter({ hasText: "Result text." });
  await result.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/mermaid");
  const command = page.locator(".milkdown-slash-menu li").filter({ hasText: "Mermaid Diagram" });
  await expect(command).toBeVisible();
  await command.click();

  await page.locator("#sourceEditorMode").click();
  await expect(page.locator("#sourceEditor")).toHaveValue(/```mermaid/);
});

test("renders uploaded video, audio, and attachments as portable rich blocks", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.locator("#editMode").click();
  await page.locator("#insertAsset").click();
  await page.locator("#assetInput").setInputFiles([
    { name: "demo.mp4", mimeType: "video/mp4", buffer: Buffer.from("video-fixture") },
    { name: "voice.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("audio-fixture") },
    { name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf-fixture") },
  ]);
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
  const insertedMarkdown = await page.evaluate(() => window.markdownReaderEditor.getMarkdown());
  expect(insertedMarkdown).toContain("demo-");
  expect(insertedMarkdown).toContain("voice-");
  expect(insertedMarkdown).toContain("paper-");

  const richEditor = page.locator(".rich-editor .ProseMirror");
  await expect(richEditor.locator(".media-html-node video[controls]")).toBeVisible();
  await expect(richEditor.locator(".media-html-node audio[controls]")).toBeVisible();
  await expect(richEditor.locator(".attachment-card").filter({ hasText: "paper.pdf" })).toBeVisible();
  await expect(page.locator("#editorState")).toHaveText("已保存", { timeout: 10_000 });

  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown).toMatch(/<video controls src="\.\/assets\/README\/demo-[a-f0-9]+\.mp4"><\/video>/);
  expect(markdown).toMatch(/<audio controls src="\.\/assets\/README\/voice-[a-f0-9]+\.mp3"><\/audio>/);
  expect(markdown).toMatch(/\[paper\.pdf]\(\.\/assets\/README\/paper-[a-f0-9]+\.pdf\)/);
  expect(markdown).not.toContain("/api/raw");

  await page.locator("#readMode").click();
  await expect(page.locator("#documentContent video[controls]")).toBeVisible();
  await expect(page.locator("#documentContent audio[controls]")).toBeVisible();
  await expect(page.locator("#documentContent a.asset-link").filter({ hasText: "paper.pdf" })).toBeVisible();
});

test("autosaves before dirty cross-file navigation", async ({ page }) => {
  await page.locator("#editMode").click();
  const paragraph = page.locator(".rich-editor .ProseMirror p").filter({ hasText: "Editable paragraph." }).first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Saved before navigation.");
  await expect(page.locator("#editorState")).toHaveText("有未保存更改");

  await page.locator('.tree-file[data-path="second.md"]').click();
  await expect(page.locator("#documentContent h1")).toHaveText("Second");
  expect(readFileSync(readmePath(), "utf8")).toContain("Saved before navigation.");
});

test("drags an ordinary paragraph without moving its heading section", async ({ page }) => {
  await page.locator("#editMode").click();
  const editor = page.locator(".rich-editor .ProseMirror");
  const result = editor.locator("p").filter({ hasText: "Result text." });
  const first = editor.locator("p").filter({ hasText: "Editable paragraph." });
  await result.hover();
  const handle = page.locator('.milkdown-block-handle[data-show="true"]');
  await expect(handle).toBeVisible();
  await handle.dragTo(first);

  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown.indexOf("Result text.")).toBeLessThan(markdown.indexOf("Editable paragraph."));
  expect(markdown.indexOf("## Results")).toBeGreaterThan(markdown.indexOf("Editable paragraph."));
});

for (const [fixture, expectedFragments] of Object.entries(roundTripCases)) {
  test(`round-trips ${fixture} through rich editing`, async ({ page }) => {
    await page.goto(`/?file=${encodeURIComponent(`fixtures/${fixture}`)}`);
    await page.locator("#editMode").click();
    await page.locator("#sourceEditorMode").click();
    const markdown = await page.locator("#sourceEditor").inputValue();
    for (const fragment of expectedFragments) expect(markdown).toContain(fragment);
    expect(markdown).not.toContain("/api/raw");
    expect(markdown).not.toContain("blob:");
    expect(markdown).not.toContain("data:image");
    expect(`${markdown.trimEnd()}\n`).toMatchSnapshot(`${fixture}.round-trip.md`);
  });
}
