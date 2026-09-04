import { DocumentView } from "./document-view";
import { readerElements } from "./dom";
import { FileTreeView, countFiles } from "./file-tree";
import { DocumentFolding } from "./folding";
import { errorMessage, getJSON } from "./http";
import type {
  DocumentResponse,
  NavigateOptions,
  Project,
  ReaderMode,
  SourceResponse,
  WorkspaceResponse,
} from "./types";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface ReaderState {
  project: Project | null;
  workspaceToken: string;
  currentPath: string;
  currentAnchor: string;
  mode: ReaderMode;
  editorDirty: boolean;
  toastTimer: number | null;
}

const state: ReaderState = {
  project: null,
  workspaceToken: document.body.dataset.workspaceToken ?? "",
  currentPath: document.body.dataset.initialFile ?? "",
  currentAnchor: decodeURIComponent(location.hash.slice(1)),
  mode: "read",
  editorDirty: false,
  toastTimer: null,
};

const elements = readerElements();
const fileTree = new FileTreeView(elements.fileTree, (path) => void navigate(path));
let updateProgress = (): void => undefined;
const folding = new DocumentFolding(
  elements.content,
  elements.toc,
  elements.toggleAllSections,
  () => `${state.project?.root ?? ""}\u0000${state.currentPath}`,
  () => updateProgress(),
);
const documentView = new DocumentView({
  elements,
  folding,
  mode: () => state.mode,
  currentPath: () => state.currentPath,
  navigate: (path, anchor) => void navigate(path, anchor),
  showToast,
});
updateProgress = () => documentView.updateProgress();

const workspaceSwitcher = new WorkspaceSwitcher({
  elements,
  workspaceToken: state.workspaceToken,
  prepareForSwitch: prepareForWorkspaceSwitch,
  onSwitched: applyWorkspace,
  showToast,
});

function updateProjectChrome(): void {
  const project = state.project;
  if (!project) return;
  elements.workspaceName.textContent = project.name;
  elements.workspaceName.title = project.root;
  elements.fileCount.textContent = `${countFiles(project.tree)} files`;
  document.body.dataset.projectName = project.name;
  elements.welcome.hidden = project.initialized;
  elements.status.hidden = !project.initialized;
  elements.editMode.disabled = !project.initialized;
}

function renderTree(filter = ""): void {
  if (!state.project) return;
  fileTree.render(state.project, state.currentPath, filter);
}

function setEditorDirty(dirty: boolean): void {
  state.editorDirty = dirty;
}

function setMode(mode: ReaderMode): void {
  state.mode = mode;
  const editing = mode === "edit";
  document.body.classList.remove("toc-open", "left-open");
  document.body.classList.toggle("editing", editing);
  elements.readMode.classList.toggle("active", !editing);
  elements.readMode.setAttribute("aria-pressed", String(!editing));
  elements.editMode.classList.toggle("active", editing);
  elements.editMode.setAttribute("aria-pressed", String(editing));
  elements.finishEdit.hidden = !editing;
  elements.saveDocument.hidden = !editing;
  elements.editor.hidden = !editing;
  elements.content.hidden = editing;
  elements.footer.hidden = editing || !state.currentPath;
  elements.readingMeta.hidden = editing;
  if (!editing) {
    void window.markdownReaderEditor.destroy();
    setEditorDirty(false);
  }
}

async function enterEditMode(): Promise<void> {
  const project = state.project;
  if (state.mode === "edit" || !project?.initialized || !state.currentPath) return;
  const requestedPath = state.currentPath;
  const requestedWorkspace = project.root;
  elements.editMode.disabled = true;
  elements.editMode.textContent = "载入中…";
  try {
    const data = await getJSON<SourceResponse>(
      `/api/source?path=${encodeURIComponent(requestedPath)}`,
      { headers: { "X-Workspace-Token": state.workspaceToken } },
    );
    if (state.currentPath !== requestedPath || state.project?.root !== requestedWorkspace) return;
    elements.editorPath.textContent = data.path;
    elements.editorPath.title = data.path;
    setMode("edit");
    await window.markdownReaderEditor.start({
      source: data.source,
      path: data.path,
      workspace: data.workspace,
      version: data.version,
      onChange: () => undefined,
      onDirtyChange: setEditorDirty,
      onTocChange: (items) => documentView.renderToc(items),
    });
    setEditorDirty(false);
    requestAnimationFrame(() => window.markdownReaderEditor.focus());
  } catch (error) {
    setMode("read");
    showToast(errorMessage(error, "无法打开编辑模式"));
  } finally {
    elements.editMode.disabled = !state.project?.initialized;
    elements.editMode.textContent = "编辑";
  }
}

async function finishEditing(): Promise<boolean> {
  if (state.mode !== "edit") return true;
  if (window.markdownReaderEditor.hasUnsavedChanges()) {
    const saved = await window.markdownReaderEditor.save();
    if (!saved) {
      showToast(
        window.markdownReaderEditor.hasConflict()
          ? "文件存在保存冲突，请先处理"
          : "保存失败，仍停留在编辑模式",
      );
      return false;
    }
  }
  setMode("read");
  await navigate(state.currentPath, "", {
    popstate: true,
    instant: true,
    skipEditorGuard: true,
  });
  return true;
}

async function saveDocument(): Promise<boolean> {
  if (state.mode !== "edit") return false;
  const saved = await window.markdownReaderEditor.save();
  showToast(
    saved
      ? "文档已保存"
      : window.markdownReaderEditor.hasConflict()
        ? "文件存在保存冲突"
        : "保存失败",
  );
  return saved;
}

async function navigate(
  path: string,
  anchor = "",
  options: NavigateOptions = {},
): Promise<boolean> {
  const project = state.project;
  if (!project || !path) return false;
  if (state.mode === "edit" && !options.skipEditorGuard) {
    if (
      window.markdownReaderEditor.hasUnsavedChanges()
      && !(await window.markdownReaderEditor.save())
    ) {
      return false;
    }
    setMode("read");
  }

  state.currentPath = path;
  state.currentAnchor = anchor;
  documentView.resetForNavigation();
  try {
    const data = await getJSON<DocumentResponse>(
      `/api/document?path=${encodeURIComponent(path)}`,
    );
    state.currentPath = data.path;
    elements.content.innerHTML = data.html;
    elements.status.hidden = true;
    elements.footer.hidden = false;
    elements.readingMeta.textContent = `${data.stats.minutes} 分钟阅读 · ${data.modified}`;
    document.title = `${data.title} · ${project.name}`;
    documentView.renderBreadcrumbs(data.path, project.name);
    documentView.renderToc(data.toc);
    renderTree(elements.fileSearch.value);
    await documentView.enhanceDocument();
    folding.setup();

    if (!options.popstate) {
      const suffix = anchor ? `#${encodeURIComponent(anchor)}` : "";
      history.pushState(
        { path: data.path, anchor },
        "",
        `/?file=${encodeURIComponent(data.path)}${suffix}`,
      );
    }
    if (anchor) {
      requestAnimationFrame(() => documentView.scrollToAnchor(anchor));
    } else {
      window.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
    }
    document.body.classList.remove("left-open");
    documentView.updateProgress();
    elements.editMode.disabled = false;
    return true;
  } catch (error) {
    elements.status.hidden = false;
    elements.status.classList.add("error");
    elements.status.innerHTML = "<span>无法打开这个 Markdown 文件。请确认文件仍位于项目目录中。</span>";
    console.error(error);
    elements.editMode.disabled = !state.project?.initialized;
    return false;
  }
}

async function prepareForWorkspaceSwitch(): Promise<boolean> {
  if (state.mode !== "edit") return true;
  if (
    window.markdownReaderEditor.hasUnsavedChanges()
    && !(await window.markdownReaderEditor.save())
  ) {
    return false;
  }
  setMode("read");
  return true;
}

async function applyWorkspace(data: WorkspaceResponse): Promise<void> {
  state.project = data.project;
  state.currentPath = data.project.initialFile;
  state.currentAnchor = "";
  setMode("read");
  elements.fileSearch.value = "";
  updateProjectChrome();
  renderTree();
  if (data.project.initialized && state.currentPath) {
    await navigate(state.currentPath, "", { popstate: true, instant: true });
    history.replaceState(
      { path: state.currentPath, anchor: "" },
      "",
      `/?file=${encodeURIComponent(state.currentPath)}`,
    );
  } else {
    renderEmptyWorkspace();
  }
}

function renderEmptyWorkspace(): void {
  elements.content.innerHTML = "";
  elements.footer.hidden = true;
  elements.toc.replaceChildren();
  documentView.renderBreadcrumbs("", state.project?.name ?? "Markdown Reader");
}

function showToast(message: string): void {
  if (state.toastTimer !== null) window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
    state.toastTimer = null;
  }, 1800);
}

function bindUI(): void {
  elements.fileSearch.addEventListener("input", () => renderTree(elements.fileSearch.value));
  elements.refreshDocument.addEventListener("click", () => {
    void navigate(state.currentPath, state.currentAnchor, { popstate: true, instant: true });
  });
  elements.readMode.addEventListener("click", () => void finishEditing());
  elements.editMode.addEventListener("click", () => void enterEditMode());
  elements.finishEdit.addEventListener("click", () => void finishEditing());
  elements.saveDocument.addEventListener("click", () => void saveDocument());
  elements.toggleAllSections.addEventListener("click", () => folding.toggleAllSections());
  elements.toggleRight.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 960px)").matches) {
      document.body.classList.toggle("toc-open");
      document.body.classList.remove("left-open");
      return;
    }
    document.body.classList.toggle("right-collapsed");
  });
  elements.openLeft.addEventListener("click", () => document.body.classList.add("left-open"));
  elements.closeLeft.addEventListener("click", () => document.body.classList.remove("left-open"));
  elements.mobileScrim.addEventListener("click", () => {
    document.body.classList.remove("left-open", "toc-open");
  });
  elements.backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  elements.openWorkspaceSwitcher.addEventListener("click", () => void workspaceSwitcher.open());
  elements.welcomeChooseWorkspace.addEventListener("click", () => void workspaceSwitcher.open());
  elements.closeWorkspaceSwitcher.addEventListener("click", () => workspaceSwitcher.close());
  elements.browseWorkspace.addEventListener("click", () => {
    void workspaceSwitcher.browse(elements.workspacePath.value.trim());
  });
  elements.directoryUp.addEventListener("click", () => void workspaceSwitcher.browseParent());
  elements.chooseCurrentDirectory.addEventListener("click", () => {
    void workspaceSwitcher.chooseCurrentDirectory();
  });
  elements.workspaceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void workspaceSwitcher.switchTo(elements.workspacePath.value);
  });
  elements.workspaceBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.workspaceBackdrop) workspaceSwitcher.close();
  });
  elements.lightbox.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target === elements.lightbox
      || (target instanceof Element && target.closest(".lightbox-close"))
    ) {
      documentView.closeLightbox();
    }
  });
  window.addEventListener("scroll", () => documentView.updateProgress(), { passive: true });
  window.addEventListener("resize", () => documentView.hidePreview(true), { passive: true });
  window.addEventListener("popstate", () => void handlePopState());
  window.addEventListener("beforeunload", (event) => {
    if (!state.editorDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("keydown", handleKeydown);
}

async function handlePopState(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const params = new URLSearchParams(location.search);
  const path = params.get("file") ?? project.initialFile;
  if (!path) return;
  const moved = await navigate(path, decodeURIComponent(location.hash.slice(1)), {
    popstate: true,
    instant: true,
  });
  if (!moved) {
    const hash = state.currentAnchor ? `#${encodeURIComponent(state.currentAnchor)}` : "";
    history.pushState(
      { path: state.currentPath, anchor: state.currentAnchor },
      "",
      `/?file=${encodeURIComponent(state.currentPath)}${hash}`,
    );
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (
    (event.ctrlKey || event.metaKey)
    && event.key.toLocaleLowerCase() === "s"
    && state.mode === "edit"
  ) {
    event.preventDefault();
    void saveDocument();
    return;
  }
  if (event.key === "Escape") {
    documentView.hidePreview(true);
    if (!elements.lightbox.hidden) {
      documentView.closeLightbox();
      return;
    }
    if (!elements.workspaceBackdrop.hidden) {
      workspaceSwitcher.close();
      return;
    }
    document.body.classList.remove("left-open", "toc-open");
  }
  const activeElement = document.activeElement;
  if (
    event.key === "/"
    && !event.ctrlKey
    && !event.metaKey
    && !(activeElement instanceof HTMLInputElement)
    && !(activeElement instanceof HTMLTextAreaElement)
    && !(activeElement instanceof HTMLElement && activeElement.isContentEditable)
  ) {
    event.preventDefault();
    elements.fileSearch.focus();
  }
}

async function init(): Promise<void> {
  bindUI();
  documentView.bindDocumentInteractions();
  try {
    state.project = await getJSON<Project>("/api/project");
    updateProjectChrome();
    renderTree();
    history.replaceState(
      { path: state.currentPath, anchor: state.currentAnchor },
      "",
      location.href,
    );
    if (state.project.initialized) {
      state.currentPath ||= state.project.initialFile;
      await navigate(state.currentPath, state.currentAnchor, { popstate: true, instant: true });
    } else {
      renderEmptyWorkspace();
    }
  } catch (error) {
    elements.status.classList.add("error");
    elements.status.innerHTML = "<span>阅读器初始化失败。请检查终端中的错误信息。</span>";
    console.error(error);
  }
}

void init();
