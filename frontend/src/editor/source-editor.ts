export interface SourceEditorElements {
  shell: HTMLElement;
  textarea: HTMLTextAreaElement;
  position: HTMLElement;
  wrapButton: HTMLButtonElement;
}

export class SourceEditorAdapter {
  private changeListener: (value: string) => void = () => undefined;

  constructor(private readonly elements: SourceEditorElements) {
    const { textarea, wrapButton } = elements;
    textarea.addEventListener("input", () => {
      this.updatePosition();
      this.changeListener(textarea.value);
    });
    textarea.addEventListener("click", () => this.updatePosition());
    textarea.addEventListener("keyup", () => this.updatePosition());
    textarea.addEventListener("select", () => this.updatePosition());
    textarea.addEventListener("keydown", (event) => this.handleKeydown(event));
    wrapButton.addEventListener("click", () => this.setWrap(textarea.classList.contains("no-wrap")));
    this.setWrap(true);
    this.updatePosition();
  }

  onChange(listener: (value: string) => void): void {
    this.changeListener = listener;
  }

  get value(): string {
    return this.elements.textarea.value;
  }

  setValue(value: string, preserveSelection = true): void {
    const { textarea } = this.elements;
    if (textarea.value === value) return;
    const start = preserveSelection ? textarea.selectionStart : 0;
    const end = preserveSelection ? textarea.selectionEnd : 0;
    textarea.value = value;
    const nextStart = Math.min(start, value.length);
    const nextEnd = Math.min(end, value.length);
    textarea.setSelectionRange(nextStart, nextEnd);
    this.updatePosition();
  }

  insert(markdown: string): void {
    const { textarea } = this.elements;
    textarea.setRangeText(markdown, textarea.selectionStart, textarea.selectionEnd, "end");
    this.updatePosition();
    this.changeListener(textarea.value);
  }

  show(visible: boolean): void {
    this.elements.shell.hidden = !visible;
  }

  focus(): void {
    this.elements.textarea.focus();
  }

  clear(): void {
    this.setValue("", false);
  }

  private setWrap(enabled: boolean): void {
    const { textarea, wrapButton } = this.elements;
    textarea.classList.toggle("no-wrap", !enabled);
    textarea.wrap = enabled ? "soft" : "off";
    wrapButton.setAttribute("aria-pressed", String(enabled));
    wrapButton.textContent = `自动换行：${enabled ? "开" : "关"}`;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    event.preventDefault();
    if (event.shiftKey) this.outdentSelection();
    else this.indentSelection();
  }

  private indentSelection(): void {
    const { textarea } = this.elements;
    const { selectionStart, selectionEnd, value } = textarea;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const selected = value.slice(lineStart, selectionEnd);
    const replacement = selected.replace(/^/gm, "  ");
    textarea.setRangeText(replacement, lineStart, selectionEnd, "select");
    textarea.setSelectionRange(selectionStart + 2, lineStart + replacement.length);
    this.updatePosition();
    this.changeListener(textarea.value);
  }

  private outdentSelection(): void {
    const { textarea } = this.elements;
    const { selectionStart, selectionEnd, value } = textarea;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const selected = value.slice(lineStart, selectionEnd);
    let removedBeforeSelection = 0;
    const replacement = selected.replace(/^( {1,2}|\t)/gm, (indent, _match, offset: number) => {
      if (offset < selectionStart - lineStart) removedBeforeSelection += indent.length;
      return "";
    });
    textarea.setRangeText(replacement, lineStart, selectionEnd, "select");
    textarea.setSelectionRange(
      Math.max(lineStart, selectionStart - removedBeforeSelection),
      lineStart + replacement.length,
    );
    this.updatePosition();
    this.changeListener(textarea.value);
  }

  private updatePosition(): void {
    const { textarea, position } = this.elements;
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lines = before.split("\n");
    const line = lines.length;
    const column = (lines.at(-1)?.length ?? 0) + 1;
    position.textContent = `第 ${line} 行，第 ${column} 列`;
  }
}
