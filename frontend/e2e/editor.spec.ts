import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = () => readFileSync("/tmp/markdown-reader-browser-root", "utf8").trim();
const readmePath = () => join(workspaceRoot(), "README.md");

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
  await expect(page.locator(".rich-editor .ProseMirror img")).toBeVisible();
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
