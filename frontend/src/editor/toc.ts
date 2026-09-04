export interface EditorHeading {
  level: number;
  title: string;
  id: string;
}

export function extractEditorHeadings(markdown: string): EditorHeading[] {
  const counts = new Map<string, number>();
  const headings: EditorHeading[] = [];
  let fence = "";
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = "";
      continue;
    }
    if (fence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const title = inlineText(match[2]);
    const base = slugifyHeading(title);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headings.push({
      level: match[1].length,
      title,
      id: count === 0 ? base : `${base}-${count}`,
    });
  }
  return headings;
}

export function slugifyHeading(value: string): string {
  const slug = value
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_\-\s\u4e00-\u9fff]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function inlineText(value: string): string {
  return value
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}
