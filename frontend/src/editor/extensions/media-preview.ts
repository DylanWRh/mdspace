import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { rawAssetUrl } from "../../app/paths";

export interface ControlledMedia {
  kind: "video" | "audio";
  source: string;
}

export function parseControlledMediaHtml(value: string): ControlledMedia | null {
  const match = value.trim().match(/^<(video|audio)\b([^>]*)>\s*<\/\1>$/i);
  if (!match) return null;
  return mediaFromTag(match[1], match[2]);
}

export function parseControlledMediaStart(value: string): ControlledMedia | null {
  const match = value.trim().match(/^<(video|audio)\b([^>]*)>$/i);
  if (!match) return null;
  return mediaFromTag(match[1], match[2]);
}

function mediaFromTag(kind: string | undefined, attributes: string | undefined): ControlledMedia | null {
  const source = attributes?.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!source) return null;
  return { kind: kind!.toLocaleLowerCase() as ControlledMedia["kind"], source };
}

export function isPortableAttachment(source: string): boolean {
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return false;
  const clean = source.split(/[?#]/, 1)[0] ?? "";
  return /(?:^|\/)assets\/[^/]+\/[^/]+\.[a-z\d]{1,12}$/i.test(clean);
}

export function mediaPreview(documentPath: string) {
  return $prose(
    () => new Plugin({
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, position) => {
            if (node.type.name !== "paragraph") return;
            decorateParagraph(node, position + 1, documentPath, decorations);
            return false;
          });
          return DecorationSet.create(state.doc, decorations);
        },
        handleClick(_view, _position, event) {
          const link = event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>("a[href]")
            : null;
          const source = link?.getAttribute("href") ?? "";
          if (!isPortableAttachment(source)) return false;
          event.preventDefault();
          window.open(rawAssetUrl(documentPath, source), "_blank", "noopener,noreferrer");
          return true;
        },
      },
    }),
  );
}

function decorateParagraph(
  paragraph: ProseMirrorNode,
  position: number,
  documentPath: string,
  decorations: Decoration[],
): void {
  let offset = 0;
  for (let index = 0; index < paragraph.childCount; index += 1) {
    const child = paragraph.child(index);
    const childPosition = position + offset;
    if (child.type.name === "html") {
      const value = typeof child.attrs.value === "string" ? child.attrs.value : "";
      const completeMedia = parseControlledMediaHtml(value);
      if (completeMedia) {
        decorations.push(
          hiddenMediaSource(childPosition, child.nodeSize),
          mediaDecoration(childPosition + child.nodeSize, completeMedia, documentPath),
        );
      } else {
        const media = parseControlledMediaStart(value);
        const closing = paragraph.maybeChild(index + 1);
        const closingValue = typeof closing?.attrs.value === "string" ? closing.attrs.value : "";
        if (
          media
          && closing?.type.name === "html"
          && closingValue.trim().toLocaleLowerCase() === `</${media.kind}>`
        ) {
          const closingPosition = childPosition + child.nodeSize;
          decorations.push(
            hiddenMediaSource(childPosition, child.nodeSize),
            hiddenMediaSource(closingPosition, closing.nodeSize),
            mediaDecoration(
              closingPosition + closing.nodeSize,
              media,
              documentPath,
            ),
          );
          offset += child.nodeSize + closing.nodeSize;
          index += 1;
          continue;
        }
      }
    }
    if (child.isText) {
      const link = child.marks.find((mark) => mark.type.name === "link");
      const source = link?.attrs.href;
      if (typeof source === "string" && isPortableAttachment(source)) {
        decorations.push(
          Decoration.inline(childPosition, childPosition + child.nodeSize, {
            class: "attachment-card",
          }),
        );
      }
    }
    offset += child.nodeSize;
  }
}

function hiddenMediaSource(position: number, size: number): Decoration {
  return Decoration.node(position, position + size, { class: "media-html-source" });
}

function mediaDecoration(
  position: number,
  media: ControlledMedia,
  documentPath: string,
): Decoration {
  return Decoration.widget(
    position,
    () => mediaWidget(media, documentPath),
    { key: `media-${position}-${media.kind}-${media.source}` },
  );
}

function mediaWidget(media: ControlledMedia, documentPath: string): HTMLElement {
  const dom = document.createElement("span");
  dom.className = "media-html-node";
  dom.dataset.mediaKind = media.kind;
  dom.contentEditable = "false";
  const player = document.createElement(media.kind);
  player.controls = true;
  player.preload = "metadata";
  player.src = rawAssetUrl(documentPath, media.source);
  player.setAttribute("aria-label", `${media.kind === "video" ? "Video" : "Audio"}: ${fileLabel(media.source)}`);
  const label = document.createElement("span");
  label.className = "media-html-label";
  label.textContent = fileLabel(media.source);
  dom.append(player, label);
  return dom;
}

function fileLabel(source: string): string {
  const clean = source.split(/[?#]/, 1)[0] ?? source;
  const name = clean.replace(/\\/g, "/").split("/").at(-1);
  return name || source;
}
