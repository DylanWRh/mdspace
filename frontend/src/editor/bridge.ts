import { EditingSession, type EditorRepresentation } from "./session";
import { RichDocumentEditor } from "./editor";
import { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import { uploadAsset } from "../api/assets";
import { assetMarkdown } from "./media";
import { loadSource, saveSource, type SaveDocumentResponse } from "../api/documents";
import { AutosaveQueue } from "./save";
import { SourceEditorAdapter } from "./source-editor";
import { extractEditorHeadings, type EditorHeading } from "./toc";
import { UploadQueue } from "./upload-queue";

const AUTOSAVE_STORAGE_KEY = "markdown-reader:autosave";

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
  focusHeading(anchor: string): boolean;
  save(): Promise<boolean>;
  hasUnsavedChanges(): boolean;
  hasConflict(): boolean;
}

export function createEditorBridge(): EditorBridge {
  const richRoot = requiredElement<HTMLElement>("#richEditor");
  const sourceEditor = new SourceEditorAdapter({
    shell: requiredElement<HTMLElement>("#sourceEditorShell"),
    textarea: requiredElement<HTMLTextAreaElement>("#sourceEditor"),
    position: requiredElement<HTMLElement>("#sourcePosition"),
    wrapButton: requiredElement<HTMLButtonElement>("#toggleSourceWrap"),
  });
  const richButton = requiredElement<HTMLButtonElement>("#richEditorMode");
  const sourceButton = requiredElement<HTMLButtonElement>("#sourceEditorMode");
  const rich = new RichDocumentEditor();
  const session = new EditingSession();
  const client = new ApiClient(document.body.dataset.workspaceToken ?? "");
  const insertAssetButton = requiredElement<HTMLButtonElement>("#insertAsset");
  const assetInput = requiredElement<HTMLInputElement>("#assetInput");
  const saveButton = requiredElement<HTMLButtonElement>("#saveDocument");
  const autosaveButton = requiredElement<HTMLButtonElement>("#toggleAutosave");
  const editorState = requiredElement<HTMLElement>("#editorState");
  const editorSaveStatus = requiredElement<HTMLElement>("#editorSaveStatus");
  const editorSaveDetail = requiredElement<HTMLElement>("#editorSaveDetail");
  const retrySave = requiredElement<HTMLButtonElement>("#retrySave");
  const editorDropOverlay = requiredElement<HTMLElement>("#editorDropOverlay");
  const conflictBanner = requiredElement<HTMLElement>("#conflictBanner");
  const reloadConflict = requiredElement<HTMLButtonElement>("#reloadConflict");
  const sourceConflict = requiredElement<HTMLButtonElement>("#sourceConflict");
  const copyConflict = requiredElement<HTMLButtonElement>("#copyConflict");
  let changeListener: (markdown: string) => void = () => undefined;
  let documentPath = "";
  let startOptions: StartOptions | null = null;
  let lastSavedAt: Date | null = null;
  let autosaveEnabled = readAutosavePreference();
  let manualFlushes = 0;

  const uploadQueue = new UploadQueue(
    {
      panel: requiredElement<HTMLElement>("#uploadPanel"),
      list: requiredElement<HTMLElement>("#uploadList"),
      summary: requiredElement<HTMLElement>("#uploadSummary"),
    },
    (busy) => {
      insertAssetButton.classList.toggle("uploading", busy);
      insertAssetButton.setAttribute("aria-busy", String(busy));
    },
  );

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
    editorSaveStatus.className = `editor-save-status ${status}`;
    editorSaveDetail.textContent = status === "clean"
      ? lastSavedAt
        ? `${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(lastSavedAt)} 写入磁盘`
        : "磁盘版本已载入"
      : status === "dirty"
        ? autosaveEnabled ? "等待自动保存" : "等待手动保存"
        : status === "saving"
          ? "正在安全写入磁盘"
          : status === "conflict"
            ? "保存已暂停，请先处理冲突"
            : error || "请重试或复制当前 Markdown";
    retrySave.hidden = status !== "error";
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
    if (autosaveEnabled && session.snapshot.status === "dirty") autosave.schedule();
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
      lastSavedAt = new Date();
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
    isDirty: () => (
      autosaveEnabled || manualFlushes > 0
    ) && (
      session.snapshot.status === "dirty" || session.snapshot.status === "error"
    ),
    save: performSave,
  });

  const renderAutosavePreference = () => {
    autosaveButton.setAttribute("aria-checked", String(autosaveEnabled));
    autosaveButton.setAttribute("aria-label", `自动保存：${autosaveEnabled ? "开" : "关"}`);
    autosaveButton.title = autosaveEnabled
      ? "自动保存已开启；点击关闭"
      : "自动保存已关闭；点击开启";
  };

  const setAutosaveEnabled = (enabled: boolean) => {
    autosaveEnabled = enabled;
    writeAutosavePreference(enabled);
    renderAutosavePreference();
    if (enabled) {
      if (session.snapshot.status === "dirty" || session.snapshot.status === "error") {
        autosave.schedule();
      }
    } else {
      autosave.cancelScheduled();
    }
    renderStatus();
  };

  const saveNow = async (): Promise<boolean> => {
    manualFlushes += 1;
    try {
      return await autosave.flush();
    } finally {
      manualFlushes -= 1;
    }
  };

  const switchRepresentation = (mode: EditorRepresentation) => {
    if (mode === session.snapshot.representation) return;
    if (mode === "source") {
      const markdown = rich.getMarkdown();
      sourceEditor.setValue(markdown);
    } else {
      rich.setMarkdown(sourceEditor.value);
    }
    session.switchRepresentation(mode);
    richRoot.hidden = mode !== "rich";
    sourceEditor.show(mode === "source");
    richButton.classList.toggle("active", mode === "rich");
    sourceButton.classList.toggle("active", mode === "source");
    richButton.setAttribute("aria-pressed", String(mode === "rich"));
    sourceButton.setAttribute("aria-pressed", String(mode === "source"));
    requestAnimationFrame(() => (mode === "rich" ? rich.focus() : sourceEditor.focus()));
  };

  richButton.addEventListener("click", () => switchRepresentation("rich"));
  sourceButton.addEventListener("click", () => switchRepresentation("source"));
  sourceEditor.onChange((value) => {
    if (session.snapshot.representation === "source") publish(value);
  });
  autosaveButton.addEventListener("click", () => setAutosaveEnabled(!autosaveEnabled));
  insertAssetButton.addEventListener("click", () => assetInput.click());
  assetInput.addEventListener("change", () => {
    const files = [...(assetInput.files ?? [])];
    assetInput.value = "";
    enqueueFiles(files);
  });
  retrySave.addEventListener("click", () => void saveNow());
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

  const enqueueFiles = (files: File[]) => {
    void uploadQueue.enqueue(
      files,
      (file) => uploadAsset(client, documentPath, file),
      (asset, file) => {
        if (session.snapshot.representation === "rich") {
          rich.insertAssets([{ asset, fileName: file.name }]);
          return;
        }
        sourceEditor.insert(`${assetMarkdown(asset, file.name)}\n`);
      },
    );
  };

  const start = async (options: StartOptions) => {
    startOptions = options;
    changeListener = options.onChange;
    documentPath = options.path;
    lastSavedAt = null;
    uploadQueue.reset();
    editorDropOverlay.hidden = true;
    autosave.resume();
    renderAutosavePreference();
    session.start({
      source: options.source,
      path: options.path,
      workspace: options.workspace,
      version: options.version,
    });
    sourceEditor.setValue(options.source, false);
    session.switchRepresentation("rich");
    richRoot.hidden = false;
    sourceEditor.show(false);
    richButton.classList.add("active");
    sourceButton.classList.remove("active");
    await rich.mount({
      root: richRoot,
      markdown: options.source,
      documentPath: options.path,
      onChange: publish,
      onFiles: enqueueFiles,
      onFileDragActive: (active) => {
        editorDropOverlay.hidden = !active;
      },
    });
    options.onTocChange?.(extractEditorHeadings(options.source));
    renderStatus();
  };

  return {
    start,
    async destroy() {
      autosave.stop();
      await rich.destroy();
      sourceEditor.clear();
      sourceEditor.show(false);
      uploadQueue.reset();
      editorDropOverlay.hidden = true;
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
      sourceEditor.setValue(markdown);
      rich.setMarkdown(markdown);
      session.update(markdown);
    },
    representation: () => session.snapshot.representation,
    switchRepresentation,
    focus() {
      if (session.snapshot.representation === "source") sourceEditor.focus();
      else rich.focus();
    },
    focusHeading(anchor) {
      if (session.snapshot.representation !== "rich") switchRepresentation("rich");
      return rich.focusHeading(anchor);
    },
    save: saveNow,
    hasUnsavedChanges: () => session.snapshot.status !== "clean",
    hasConflict: () => session.snapshot.status === "conflict",
  };
}

function readAutosavePreference(): boolean {
  try {
    return window.localStorage.getItem(AUTOSAVE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeAutosavePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, String(enabled));
  } catch {
    // Autosave still works for this page when browser storage is unavailable.
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required editor element not found: ${selector}`);
  return element;
}
