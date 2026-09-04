import type { ApiClient } from "./client";

export interface AssetResponse {
  path: string;
  relativePath: string;
  kind: "image" | "video" | "audio" | "pdf" | "file";
  mediaType: string;
  name: string;
  size: number;
}

export function uploadAsset(
  client: ApiClient,
  documentPath: string,
  file: File,
): Promise<AssetResponse> {
  const body = new FormData();
  body.set("document", documentPath);
  body.set("file", file, file.name);
  return client.postForm("/api/assets", body);
}
