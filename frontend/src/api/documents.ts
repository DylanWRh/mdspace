import type { ApiClient } from "./client";

export interface SourceDocument {
  path: string;
  source: string;
  version: string;
  workspace: string;
}

export interface RenderedDocument {
  path: string;
  title: string;
  html: string;
  toc: Array<{ level: number; title: string; id: string }>;
  stats: { words: number; minutes: number };
  modified: string;
}

export interface SaveDocumentResponse extends SourceDocument {
  document: RenderedDocument;
}

export function loadSource(
  client: ApiClient,
  path: string,
): Promise<SourceDocument> {
  return client.get(`/api/source?path=${encodeURIComponent(path)}`);
}

export function saveSource(
  client: ApiClient,
  document: SourceDocument,
  source: string,
): Promise<SaveDocumentResponse> {
  return client.put("/api/source", {
    path: document.path,
    source,
    version: document.version,
    workspace: document.workspace,
  });
}
