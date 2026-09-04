import type { AssetResponse } from "../api/assets";

export function assetMarkdown(asset: AssetResponse, label = asset.name): string {
  const safeLabel = label.replaceAll("[", "\\[").replaceAll("]", "\\]");
  const safeAttribute = asset.relativePath.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  if (asset.kind === "image") return `![${safeLabel}](${asset.relativePath})`;
  if (asset.kind === "video") return `<video controls src="${safeAttribute}"></video>`;
  if (asset.kind === "audio") return `<audio controls src="${safeAttribute}"></audio>`;
  return `[${safeLabel}](${asset.relativePath})`;
}
