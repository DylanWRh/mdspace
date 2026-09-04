export type ReaderMode = "read" | "edit";

export interface TocItem {
  id: string;
  level: number;
  title: string;
}

export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface FileNode {
  type: "markdown" | "file";
  name: string;
  path: string;
}

export type TreeNode = FolderNode | FileNode;

export interface Project {
  name: string;
  root: string;
  initialized: boolean;
  initialFile: string;
  tree: TreeNode[];
}

export interface DocumentResponse {
  path: string;
  html: string;
  title: string;
  modified: string;
  stats: {
    minutes: number;
  };
  toc: TocItem[];
}

export interface SourceResponse {
  path: string;
  source: string;
  workspace: string;
  version: string;
}

export interface PreviewResponse {
  path: string;
  html: string;
}

export interface RecentWorkspace {
  name: string;
  path: string;
  current: boolean;
  available: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryBrowser {
  path: string;
  parent: string | null;
  hasMarkdown: boolean;
  directories: DirectoryEntry[];
  drives?: DirectoryEntry[];
}

export interface WorkspacesResponse {
  recent: RecentWorkspace[];
}

export interface WorkspaceResponse extends WorkspacesResponse {
  project: Project;
}

export interface NavigateOptions {
  popstate?: boolean;
  instant?: boolean;
  skipEditorGuard?: boolean;
}
