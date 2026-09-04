const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

export function documentRelativePath(documentPath: string, assetPath: string): string {
  if (EXTERNAL_URL.test(assetPath)) return assetPath;
  const directory = documentPath.split("/").slice(0, -1);
  const parts = [...directory, ...assetPath.replace(/\\/g, "/").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

export function rawAssetUrl(documentPath: string, source: string): string {
  if (EXTERNAL_URL.test(source) || source.startsWith("data:") || source.startsWith("blob:")) {
    return source;
  }
  return `/api/raw?path=${encodeURIComponent(documentRelativePath(documentPath, source)).replaceAll("%2F", "/")}`;
}
