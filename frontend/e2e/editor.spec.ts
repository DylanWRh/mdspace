import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootMarker = join(tmpdir(), "markdown-reader-browser-root");
const workspaceRoot = () => readFileSync(rootMarker, "utf8").trim();
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

test("renders backslash-delimited math and visible italic emphasis", async ({ page }) => {
  writeFileSync(
    readmePath(),
    String.raw`# Reader Rendering

Inline \(x^2 + y^2\) and *italic text*.

\[
\frac{1}{3}
\]
`,
  );
  await page.goto("/");

  await expect(page.locator("#documentContent .math.inline mjx-container")).toBeVisible();
  await expect(page.locator("#documentContent .math.block mjx-container[display='true']")).toBeVisible();
  const emphasis = page.locator("#documentContent em");
  await expect(emphasis).toHaveText("italic text");
  await expect(emphasis).toHaveCSS("font-style", "italic");
});

test("loads packaged math fonts from the static asset directory", async ({ page }) => {
  const fontStatuses: number[] = [];
  page.on("response", (response) => {
    if (/KaTeX_.+\.(?:woff2?|ttf)$/.test(response.url())) {
      fontStatuses.push(response.status());
    }
  });

  await page.goto("/?file=fixtures/math.md");
  await page.locator("#editMode").click();
  await expect(page.locator(".rich-editor .katex").first()).toBeVisible();
  await expect.poll(() => fontStatuses.length).toBeGreaterThan(0);
  expect(fontStatuses.every((status) => status === 200)).toBe(true);
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

  await page.locator("#finishEdit").click();
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
  const method = page.getByRole("button", { name: "移动章节：Method" });
  const results = page.getByRole("button", { name: "移动章节：Results" });
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
  const command = page.locator(".milkdown-slash-menu li").filter({ hasText: "Mermaid 图表" });
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

  await page.locator("#finishEdit").click();
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
  const targetBox = await first.boundingBox();
  expect(targetBox).not.toBeNull();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await handle.dispatchEvent("mousedown", { button: 0 });
  await handle.dispatchEvent("dragstart", { dataTransfer: transfer });
  await first.dispatchEvent("dragenter", { dataTransfer: transfer });
  await first.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientX: targetBox!.x + 24,
    clientY: targetBox!.y + 6,
  });
  await first.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: targetBox!.x + 24,
    clientY: targetBox!.y + 6,
  });
  await handle.dispatchEvent("dragend", { dataTransfer: transfer });

  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown.indexOf("Result text.")).toBeLessThan(markdown.indexOf("Editable paragraph."));
  expect(markdown.indexOf("## Results")).toBeGreaterThan(markdown.indexOf("Editable paragraph."));
});

test("renders bounded editor popovers with discoverable controls", async ({ page }) => {
  await page.locator("#editMode").click();
  const editor = page.locator(".rich-editor .ProseMirror");
  const paragraph = editor.locator("p").filter({ hasText: "Editable paragraph." }).first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");

  const toolbar = page.locator(".milkdown-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarStyle = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      shadow: style.boxShadow,
      zIndex: Number(style.zIndex),
    };
  });
  expect(toolbarStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(toolbarStyle.background).not.toBe("transparent");
  expect(toolbarStyle.border === "1px" || toolbarStyle.shadow !== "none").toBe(true);
  expect(toolbarStyle.zIndex).toBeGreaterThan(70);
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox!.x).toBeGreaterThanOrEqual(0);
  expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(1280);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const slashMenu = page.locator(".milkdown-slash-menu");
  await expect(slashMenu).toBeVisible();
  const slashStyle = await slashMenu.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
  });
  expect(slashStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(slashStyle.border === "1px" || slashStyle.shadow !== "none").toBe(true);

  const sectionHandle = page.getByRole("button", { name: "移动章节：Method" });
  await expect(sectionHandle).toBeVisible();
  await sectionHandle.click();
  await page.keyboard.press("Tab");
  const sectionAction = page.getByRole("button", { name: "上移章节：Method" });
  await sectionAction.focus();
  await expect(sectionAction).toBeFocused();
  const handleStyle = await sectionAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle };
  });
  expect(handleStyle.outline).not.toBe("none");
});

test("supports source navigation, wrapping, and indentation", async ({ page }) => {
  await page.locator("#editMode").click();
  await page.locator("#sourceEditorMode").click();
  const source = page.locator("#sourceEditor");
  await source.fill("# Title\n\n  indented\nnext");
  await source.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(11, 21);
    element.dispatchEvent(new Event("select"));
  });
  await expect(page.locator("#sourcePosition")).toContainText("第 3 行");
  await source.press("Shift+Tab");
  await expect(source).toHaveValue("# Title\n\nindented\nnext");

  await page.locator("#toggleSourceWrap").click();
  await expect(page.locator("#toggleSourceWrap")).toHaveAttribute("aria-pressed", "false");
  await expect(source).toHaveClass(/no-wrap/);
});

test("moves sections and ordinary blocks with the keyboard", async ({ page }) => {
  await page.locator("#editMode").click();
  const method = page.getByRole("button", { name: "移动章节：Method" });
  await method.focus();
  await method.press("Alt+ArrowDown");
  await expect(page.locator("#editorAnnouncement")).toHaveText("已移动章节：Method");

  const editable = page.locator(".rich-editor .ProseMirror p").filter({ hasText: "Editable paragraph." });
  await editable.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator("#editorAnnouncement")).toHaveText("已移动当前内容块");

  await page.locator("#sourceEditorMode").click();
  const markdown = await page.locator("#sourceEditor").inputValue();
  expect(markdown.indexOf("## Results")).toBeLessThan(markdown.indexOf("## Method"));
  expect(markdown.indexOf("Editable paragraph.")).toBeGreaterThan(markdown.indexOf("## Results"));
});

test("uses the live editing outline to focus headings", async ({ page }) => {
  await page.locator("#editMode").click();
  const methodLink = page.locator("#tableOfContents .toc-link").filter({ hasText: "Method" });
  await methodLink.click();
  await expect(methodLink).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => {
    const selection = window.getSelection();
    const element = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    return element?.closest("h1,h2,h3,h4,h5,h6")?.textContent ?? "";
  })).toBe("Method");
  await expect(page).toHaveURL(/#method$/);
});

test("keeps mobile editor controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#editMode").click();
  const headerBox = await page.locator(".editor-header").boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headerBox!.height).toBeLessThan(180);

  const paragraph = page.locator(".rich-editor .ProseMirror p").filter({ hasText: "Editable paragraph." });
  await paragraph.hover();
  const blockHandle = page.locator('.milkdown-block-handle[data-show="true"]');
  await expect(blockHandle).toBeVisible();
  const blockBox = await blockHandle.boundingBox();
  expect(blockBox).not.toBeNull();
  expect(blockBox!.x).toBeGreaterThanOrEqual(0);
  expect(blockBox!.x + blockBox!.width).toBeLessThanOrEqual(390);

  const sectionHandleBox = await page.getByRole("button", { name: "移动章节：Method" }).boundingBox();
  expect(sectionHandleBox).not.toBeNull();
  expect(sectionHandleBox!.width).toBeGreaterThanOrEqual(40);

  await page.locator("#toggleRight").click();
  await expect(page.locator("#tocSidebar")).toBeInViewport();
  await page.locator("#tableOfContents .toc-link").filter({ hasText: "Results" }).click();
  await expect(page.locator("body")).not.toHaveClass(/toc-open/);
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 720, height: 500 },
  { width: 960, height: 600 },
]) {
  test(`keeps block actions reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.locator("#editMode").click();
    const paragraph = page.locator(".rich-editor .ProseMirror p").filter({ hasText: "Editable paragraph." });
    await paragraph.hover();
    const handle = page.locator('.milkdown-block-handle[data-show="true"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width <= 720) {
      const itemBox = await handle.locator(".operation-item").first().boundingBox();
      expect(itemBox).not.toBeNull();
      expect(itemBox!.width).toBeGreaterThanOrEqual(40);
      expect(itemBox!.height).toBeGreaterThanOrEqual(40);
    }
  });
}

test("shows upload progress and clears the file-drop affordance", async ({ page }) => {
  await page.locator("#editMode").click();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["drop-image"], "dropped.png", { type: "image/png" }));
    return data;
  });
  await page.dispatchEvent("#richEditor", "dragenter", { dataTransfer: transfer });
  await expect(page.locator("#editorDropOverlay")).toBeVisible();
  await page.dispatchEvent("#richEditor", "drop", { dataTransfer: transfer });
  await expect(page.locator("#editorDropOverlay")).toBeHidden();
  await expect(page.locator("#uploadPanel")).toBeVisible();
  await expect(page.locator("#uploadSummary")).toContainText("1 个文件已插入");
  await expect(page.locator(".upload-item.done")).toContainText("dropped.png");
});

test("captures stable desktop and mobile editor chrome", async ({ page }) => {
  await page.locator("#editMode").click();
  const desktopShell = await page.locator("#editorShell").boundingBox();
  expect(desktopShell).not.toBeNull();
  await expect(page).toHaveScreenshot("editor-chrome-desktop.png", {
    animations: "disabled",
    clip: {
      x: desktopShell!.x,
      y: desktopShell!.y,
      width: desktopShell!.width,
      height: Math.min(600, 720 - desktopShell!.y),
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileShell = await page.locator("#editorShell").boundingBox();
  expect(mobileShell).not.toBeNull();
  await expect(page).toHaveScreenshot("editor-chrome-mobile.png", {
    animations: "disabled",
    clip: {
      x: mobileShell!.x,
      y: mobileShell!.y,
      width: mobileShell!.width,
      height: Math.min(760, 844 - mobileShell!.y),
    },
  });
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
