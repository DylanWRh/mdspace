// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SourceEditorAdapter } from "./source-editor";

function fixture() {
  document.body.innerHTML = `
    <section id="shell">
      <textarea id="source"></textarea>
      <span id="position"></span>
      <button id="wrap" type="button"></button>
    </section>`;
  const textarea = document.querySelector<HTMLTextAreaElement>("#source")!;
  const position = document.querySelector<HTMLElement>("#position")!;
  const wrapButton = document.querySelector<HTMLButtonElement>("#wrap")!;
  const adapter = new SourceEditorAdapter({
    shell: document.querySelector<HTMLElement>("#shell")!,
    textarea,
    position,
    wrapButton,
  });
  return { adapter, textarea, position, wrapButton };
}

describe("SourceEditorAdapter", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("reports the caret position and toggles wrapping", () => {
    const { adapter, textarea, position, wrapButton } = fixture();
    adapter.setValue("first\nsecond", false);
    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new Event("select"));
    expect(position.textContent).toContain("第 2 行，第 3 列");

    wrapButton.click();
    expect(textarea.classList.contains("no-wrap")).toBe(true);
    expect(wrapButton.getAttribute("aria-pressed")).toBe("false");
    expect(wrapButton.textContent).toContain("自动换行：关");
  });

  it("indents and outdents selected lines while publishing the change", () => {
    const { adapter, textarea } = fixture();
    const onChange = vi.fn();
    adapter.onChange(onChange);
    adapter.setValue("alpha\nbeta", false);
    textarea.setSelectionRange(0, textarea.value.length);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(textarea.value).toBe("  alpha\n  beta");

    textarea.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }));
    expect(textarea.value).toBe("alpha\nbeta");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
