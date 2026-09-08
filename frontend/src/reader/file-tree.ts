import { escapeHtml } from "./html";
import type { Project, TreeNode } from "./types";

const icons = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  markdown: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M14 3.5v4h4M7 16v-5l2 2 2-2v5M13 14l2 2 2-2M15 11v5"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M14 3.5v4h4"/></svg>',
};

interface TreeRenderResult {
  fragment: DocumentFragment;
  visibleCount: number;
}

export function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.type === "folder" ? countFiles(node.children) : 1),
    0,
  );
}

export class FileTreeView {
  private readonly expandedPaths = new Set<string>();
  private projectRoot = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly navigate: (path: string) => void,
  ) {}

  render(project: Project, currentPath: string, filter = ""): void {
    if (project.root !== this.projectRoot) {
      this.projectRoot = project.root;
      this.expandedPaths.clear();
    }
    const { fragment, visibleCount } = this.createTree(
      project.tree,
      currentPath,
      filter,
    );
    this.root.replaceChildren(fragment);
    if (visibleCount === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = "没有匹配的文件";
      this.root.append(empty);
    }
  }

  private createTree(
    nodes: TreeNode[],
    currentPath: string,
    filter: string,
  ): TreeRenderResult {
    const fragment = document.createDocumentFragment();
    const query = filter.trim().toLocaleLowerCase();
    let visibleCount = 0;

    for (const node of nodes) {
      if (node.type === "folder") {
        const childResult = this.createTree(node.children, currentPath, filter);
        const selfMatches = node.name.toLocaleLowerCase().includes(query);
        if (query && !selfMatches && childResult.visibleCount === 0) continue;

        const group = document.createElement("div");
        group.className = query || this.expandedPaths.has(node.path)
          ? "tree-group"
          : "tree-group collapsed";
        group.dataset.path = node.path;
        const row = document.createElement("div");
        row.className = "tree-row";
        row.style.paddingLeft = "6px";
        row.innerHTML = `<span class="tree-toggle">⌄</span><span class="tree-icon">${icons.folder}</span><span class="tree-label">${escapeHtml(node.name)}</span>`;
        row.title = node.path;
        row.addEventListener("click", () => {
          const collapsed = group.classList.toggle("collapsed");
          if (collapsed) this.expandedPaths.delete(node.path);
          else this.expandedPaths.add(node.path);
        });
        const children = document.createElement("div");
        children.className = "tree-children";
        children.append(childResult.fragment);
        group.append(row, children);
        fragment.append(group);
        visibleCount += childResult.visibleCount;
        continue;
      }

      if (
        query
        && !node.name.toLocaleLowerCase().includes(query)
        && !node.path.toLocaleLowerCase().includes(query)
      ) {
        continue;
      }
      const row = document.createElement("a");
      row.className = `tree-row tree-file${node.path === currentPath ? " active" : ""}`;
      row.dataset.path = node.path;
      row.title = node.path;
      row.href = node.type === "markdown"
        ? `/?file=${encodeURIComponent(node.path)}`
        : `/api/raw?path=${encodeURIComponent(node.path)}`;
      if (node.type !== "markdown") row.target = "_blank";
      row.innerHTML = `<span class="tree-toggle"></span><span class="tree-icon">${node.type === "markdown" ? icons.markdown : icons.file}</span><span class="tree-label">${escapeHtml(node.name)}</span>`;
      if (node.type === "markdown") {
        row.addEventListener("click", (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          this.navigate(node.path);
        });
      }
      fragment.append(row);
      visibleCount += 1;
    }
    return { fragment, visibleCount };
  }

}
