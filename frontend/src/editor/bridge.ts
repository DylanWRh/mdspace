import { EditingSession, type EditorRepresentation } from "./session";
import { RichDocumentEditor } from "./editor";
import { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import { uploadAsset } from "../api/assets";
import { assetMarkdown } from "./media";
import { loadSource, saveSource, type SaveDocumentResponse } from "../api/documents";
import { AutosaveQueue } from "./save";
import { extractEditorHeadings, type EditorHeading } from "./toc";

interface StartOptions {
  source: string;
  path: string;
  workspace: string;
  version: string;
  onChange: (markdown: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (response: SaveDocumentResponse) => void;
  onTocChange?: (headings: EditorHeading[]) => void;
}

export interface EditorBridge {
  start(options: StartOptions): Promise<void>;
  destroy(): Promise<void>;
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  representation(): EditorRepresentation;
  switchRepresentation(mode: EditorRepresentation): void;
  focus(): void;
  save(): Promise<boolean>;
  hasUnsavedChanges(): boolean;
  hasConflict(): boolean;
}

export function createEditorBridge(): EditorBridge {
  const richRoot = requiredElement<HTMLElement>("#richEditor");
  const sourceEditor = requiredElement<HTMLTextAreaElement>("#sourceEditor");
  const richButton = requiredElement<HTMLButtonElement>("#richEditorMode");
  const sourceButton = requiredElement<HTMLButtonElement>("#sourceEditorMode");
  const rich = new RichDocumentEditor();
  const session = new EditingSession();
  const client = new ApiClient(document.body.dataset.workspaceToken ?? "");
  const insertAssetButton = requiredElement<HTMLButtonElement>("#insertAsset");
  const assetInput = requiredElement<HTMLInputElement>("#assetInput");
  const saveButton = requiredElement<HTMLButtonElement>("#saveDocument");
  const editorState = requiredElement<HTMLElement>("#editorState");
  const conflictBanner = requiredElement<HTMLElement>("#conflictBanner");
  const reloadConflict = requiredElement<HTMLButtonElement>("#reloadConflict");
  const sourceConflict = requiredElement<HTMLButtonElement>("#sourceConflict");
  const copyConflict = requiredElement<HTMLButtonElement>("#copyConflict");
  let changeListener: (markdown: string) => void = () => undefined;
  let documentPath = "";
  let startOptions: StartOptions | null = null;

  const renderStatus = () => {
    const { status, error } = session.snapshot;
    const labels = {
      clean: "已保存",
      dirty: "有未保存更改",
      saving: "正在保存…",
      conflict: "保存冲突",
      error: "保存失败",
    } as const;
    editorState.textContent = labels[status];
    editorState.title = error;
    editorState.classList.toggle("dirty", status === "dirty" || status === "conflict" || status === "error");
    saveButton.disabled = status === "clean" || status === "saving" || status === "conflict";
    saveButton.textContent = status === "saving" ? "保存中…" : "保存";
    conflictBanner.hidden = status !== "conflict";
    startOptions?.onDirtyChange?.(status !== "clean");
  };

  const publish = (markdown: string) => {
    session.update(markdown);
    renderStatus();
    changeListener(markdown);
    startOptions?.onTocChange?.(extractEditorHeadings(markdown));
    if (session.snapshot.status === "dirty") autosave.schedule();
  };

  const performSave = async (): Promise<boolean> => {
    const current = session.snapshot;
    if (current.status === "conflict" || current.status === "clean") return current.status === "clean";
    const markdown = current.representation === "source" ? sourceEditor.value : rich.getMarkdown();
    session.update(markdown);
    session.beginSave();
    renderStatus();
    try {
      const response = await saveSource(
        client,
        {
          path: current.path,
          workspace: current.workspace,
          version: current.version,
          source: current.savedMarkdown,
        },
        markdown,
      );
      const latest = session.snapshot.representation === "source" ? sourceEditor.value : rich.getMarkdown();
      session.update(latest);
      session.saved(response.source, response.version);
      renderStatus();
      startOptions?.onSaved?.(response);
      return true;
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      session.failed(error instanceof Error ? error.message : "Save failed", conflict);
      if (conflict) autosave.pause();
      renderStatus();
      return false;
    }
  };

  const autosave = new AutosaveQueue({
    delay: 1000,
    isDirty: () => session.snapshot.status === "dirty" || session.snapshot.status === "error",
    save: performSave,
  });

  const switchRepresentation = (mode: EditorRepresentation) => {
    if (mode === session.snapshot.representation) return;
    if (mode === "source") {
      const markdown = rich.getMarkdown();
      sourceEditor.value = markdown;
      publish(markdown);
    } else {
      rich.setMarkdown(sourceEditor.value);
      publish(sourceEditor.value);
    }
    session.switchRepresentation(mode);
    richRoot.hidden = mode !== "rich";
    sourceEditor.hidden = mode !== "source";
    richButton.classList.toggle("active", mode === "rich");
    sourceButton.classList.toggle("active", mode === "source");
    richButton.setAttribute("aria-pressed", String(mode === "rich"));
    sourceButton.setAttribute("aria-pressed", String(mode === "source"));
    requestAnimationFrame(() => (mode === "rich" ? rich.focus() : sourceEditor.focus()));
  };

  richButton.addEventListener("click", () => switchRepresentation("rich"));
  sourceButton.addEventListener("click", () => switchRepresentation("source"));
  sourceEditor.addEventListener("input", () => {
    if (session.snapshot.representation === "source") publish(sourceEditor.value);
  });
  sourceEditor.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    sourceEditor.setRangeText(
      "  ",
      sourceEditor.selectionStart,
      sourceEditor.selectionEnd,
      "end",
    );
    publish(sourceEditor.value);
  });
  insertAssetButton.addEventListener("click", () => assetInput.click());
  assetInput.addEventListener("change", async () => {
    const files = [...(assetInput.files ?? [])];
    assetInput.value = "";
    if (session.snapshot.representation === "rich") {
      await rich.insertFiles(files);
      return;
    }
    const markdown = (
      await Promise.all(
        files.map(async (file) => assetMarkdown(await uploadAsset(client, documentPath, file), file.name)),
      )
    ).join("\n\n");
    sourceEditor.setRangeText(
      `${markdown}\n`,
      sourceEditor.selectionStart,
      sourceEditor.selectionEnd,
      "end",
    );
    publish(sourceEditor.value);
  });
  reloadConflict.addEventListener("click", async () => {
    const current = session.snapshot;
    const external = await loadSource(client, current.path);
    if (!startOptions) return;
    await rich.destroy();
    await start({ ...startOptions, ...external });
  });
  sourceConflict.addEventListener("click", () => switchRepresentation("source"));
  copyConflict.addEventListener("click", async () => {
    await navigator.clipboard.writeText(
      session.snapshot.representation === "source" ? sourceEditor.value : rich.getMarkdown(),
    );
  });

  const start = async (options: StartOptions) => {
    startOptions = options;
    changeListener = options.onChange;
    documentPath = options.path;
    autosave.resume();
    session.start({
      source: options.source,
      path: options.path,
      workspace: options.workspace,
      version: options.version,
    });
    sourceEditor.value = options.source;
    session.switchRepresentation("rich");
    richRoot.hidden = false;
    sourceEditor.hidden = true;
    richButton.classList.add("active");
    sourceButton.classList.remove("active");
    await rich.mount({
      root: richRoot,
      markdown: options.source,
      documentPath: options.path,
      onChange: publish,
      uploadFile: (file) => uploadAsset(client, options.path, file),
    });
    options.onTocChange?.(extractEditorHeadings(options.source));
    renderStatus();
  };

  return {
    start,
    async destroy() {
      autosave.stop();
      await rich.destroy();
      sourceEditor.value = "";
      session.reset();
      documentPath = "";
      startOptions = null;
      renderStatus();
    },
    getMarkdown() {
      return session.snapshot.representation === "source"
        ? sourceEditor.value
        : rich.getMarkdown();
    },
    setMarkdown(markdown) {
      sourceEditor.value = markdown;
      rich.setMarkdown(markdown);
      session.update(markdown);
    },
    representation: () => session.snapshot.representation,
    switchRepresentation,
    focus() {
      if (session.snapshot.representation === "source") sourceEditor.focus();
      else rich.focus();
    },
    save: () => autosave.flush(),
    hasUnsavedChanges: () => session.snapshot.status !== "clean",
    hasConflict: () => session.snapshot.status === "conflict",
  };
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required editor element not found: ${selector}`);
  return element;
}
