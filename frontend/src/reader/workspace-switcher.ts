import type { ReaderElements } from "./dom";
import { escapeHtml } from "./html";
import { errorMessage, getJSON } from "./http";
import type {
  DirectoryBrowser,
  RecentWorkspace,
  WorkspaceResponse,
  WorkspacesResponse,
} from "./types";

export interface WorkspaceSwitcherOptions {
  elements: ReaderElements;
  workspaceToken: string;
  prepareForSwitch: () => Promise<boolean>;
  onSwitched: (data: WorkspaceResponse) => Promise<void>;
  showToast: (message: string) => void;
}

export class WorkspaceSwitcher {
  private recentWorkspaces: RecentWorkspace[] = [];
  private directoryBrowser: DirectoryBrowser | null = null;

  constructor(private readonly options: WorkspaceSwitcherOptions) {}

  async open(): Promise<void> {
    const { elements } = this.options;
    elements.workspaceError.hidden = true;
    elements.workspacePath.value = "";
    this.directoryBrowser = null;
    this.renderDirectoryBrowser();
    elements.workspaceBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    try {
      const data = await getJSON<WorkspacesResponse>("/api/workspaces");
      this.recentWorkspaces = data.recent;
      this.renderWorkspaceList();
    } catch (error) {
      this.showError(error, "无法读取最近工作区");
    }
    requestAnimationFrame(() => elements.workspacePath.focus());
  }

  close(): void {
    this.options.elements.workspaceBackdrop.hidden = true;
    document.body.style.overflow = "";
  }

  async browse(path = ""): Promise<void> {
    const { elements, workspaceToken } = this.options;
    elements.workspaceError.hidden = true;
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      this.directoryBrowser = await getJSON<DirectoryBrowser>(`/api/directories${query}`, {
        headers: { "X-Workspace-Token": workspaceToken },
      });
      this.renderDirectoryBrowser();
    } catch (error) {
      this.showError(error, "无法浏览此目录");
    }
  }

  browseParent(): Promise<void> {
    return this.browse(this.directoryBrowser?.parent ?? "");
  }

  chooseCurrentDirectory(): Promise<void> {
    return this.switchTo(this.directoryBrowser?.path ?? "");
  }

  async switchTo(path: string): Promise<void> {
    const { elements, workspaceToken } = this.options;
    const candidate = path.trim();
    if (!candidate) {
      elements.workspaceError.textContent = "请输入工作区目录。";
      elements.workspaceError.hidden = false;
      return;
    }
    if (!(await this.options.prepareForSwitch())) return;

    elements.workspaceError.hidden = true;
    elements.switchWorkspace.disabled = true;
    elements.switchWorkspace.textContent = "打开中…";
    try {
      const data = await getJSON<WorkspaceResponse>("/api/workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Token": workspaceToken,
        },
        body: JSON.stringify({ path: candidate }),
      });
      this.recentWorkspaces = data.recent;
      await this.options.onSwitched(data);
      this.close();
      this.options.showToast(`已切换到 ${data.project.name}`);
    } catch (error) {
      this.showError(error, "无法打开工作区");
    } finally {
      elements.switchWorkspace.disabled = false;
      elements.switchWorkspace.textContent = "打开";
    }
  }

  private renderWorkspaceList(): void {
    const { workspaceList } = this.options.elements;
    workspaceList.replaceChildren();
    if (!this.recentWorkspaces.length) {
      workspaceList.innerHTML = '<div class="tree-empty">还没有最近使用的工作区</div>';
      return;
    }
    for (const workspace of this.recentWorkspaces) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `workspace-item${workspace.current ? " current" : ""}`;
      button.disabled = !workspace.available || workspace.current;
      button.title = workspace.available ? workspace.path : "这个目录已不存在";
      button.innerHTML = `
        <span class="workspace-item-icon"><svg viewBox="0 0 24 24"><path d="M3 6.8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></span>
        <span class="workspace-item-copy"><span class="workspace-item-name">${escapeHtml(workspace.name)}</span><span class="workspace-item-path">${escapeHtml(workspace.path)}</span></span>
        ${workspace.current ? '<span class="workspace-current-badge">当前</span>' : ""}`;
      if (workspace.available && !workspace.current) {
        button.addEventListener("click", () => void this.switchTo(workspace.path));
      }
      workspaceList.append(button);
    }
  }

  private renderDirectoryBrowser(): void {
    const { elements } = this.options;
    const data = this.directoryBrowser;
    elements.directoryBrowser.hidden = !data;
    if (!data) return;
    elements.directoryLocation.textContent = data.path;
    elements.directoryLocation.title = data.path;
    elements.directoryUp.disabled = !data.parent;
    elements.directoryStatus.textContent = data.hasMarkdown
      ? "当前目录包含 Markdown"
      : "选择后将检查子目录中的 Markdown";
    elements.directoryStatus.classList.toggle("available", data.hasMarkdown);
    elements.chooseCurrentDirectory.disabled = false;
    elements.directoryList.replaceChildren();
    const entries = [...(data.drives ?? []), ...data.directories];
    if (!entries.length) {
      elements.directoryList.innerHTML = '<div class="tree-empty">没有可浏览的子目录</div>';
      return;
    }
    for (const directory of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "directory-entry";
      button.title = directory.path;
      button.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 6.8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg><span>${escapeHtml(directory.name)}</span>`;
      button.addEventListener("click", () => void this.browse(directory.path));
      elements.directoryList.append(button);
    }
  }

  private showError(error: unknown, fallback: string): void {
    const { workspaceError } = this.options.elements;
    workspaceError.textContent = errorMessage(error, fallback);
    workspaceError.hidden = false;
  }
}
