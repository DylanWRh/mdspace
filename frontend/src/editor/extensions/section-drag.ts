import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, NodeSelection, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";


export const SECTION_DRAG_MIME = "application/x-markdown-reader-section";

export interface SectionRange {
  from: number;
  to: number;
  level: number;
}

export function findSectionRange(
  doc: ProseMirrorNode,
  headingPosition: number,
): SectionRange | null {
  const heading = doc.nodeAt(headingPosition);
  if (!heading || heading.type.name !== "heading") return null;
  const level = Number(heading.attrs.level);
  let to = doc.content.size;
  let seenHeading = false;
  doc.forEach((node, offset) => {
    if (offset === headingPosition) {
      seenHeading = true;
      return;
    }
    if (
      seenHeading &&
      node.type.name === "heading" &&
      Number(node.attrs.level) <= level &&
      to === doc.content.size
    ) {
      to = offset;
    }
  });
  return { from: headingPosition, to, level };
}

export function findSectionDropTarget(
  doc: ProseMirrorNode,
  range: SectionRange,
  rawPosition: number,
): number | null {
  if (rawPosition > range.from && rawPosition < range.to) return null;
  if (rawPosition <= 0) return range.from === 0 ? null : 0;
  if (rawPosition >= doc.content.size) {
    return range.to === doc.content.size ? null : doc.content.size;
  }

  const resolved = doc.resolve(rawPosition);
  const target = resolved.depth > 0 ? resolved.before(1) : rawPosition;
  if (target >= range.from && target <= range.to) return null;
  return target;
}

export function moveSection(
  transaction: Transaction,
  range: SectionRange,
  dropTarget: number,
): Transaction | null {
  if (
    dropTarget < 0 ||
    dropTarget > transaction.doc.content.size ||
    (dropTarget >= range.from && dropTarget <= range.to)
  ) {
    return null;
  }
  const content = transaction.doc.slice(range.from, range.to).content;
  const size = range.to - range.from;
  transaction.delete(range.from, range.to);
  const mappedTarget = dropTarget > range.to ? dropTarget - size : dropTarget;
  transaction.insert(mappedTarget, content);
  transaction.setSelection(NodeSelection.create(transaction.doc, mappedTarget));
  return transaction;
}

export const sectionDrag = $prose(
  () =>
    new Plugin({
      key: new PluginKey("MARKDOWN_READER_SECTION_DRAG"),
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.forEach((node, position) => {
            if (node.type.name !== "heading") return;
            decorations.push(
              Decoration.widget(
                position,
                () => sectionHandle(position, node.textContent),
                { key: `section-handle-${position}`, side: -1 },
              ),
            );
          });
          return DecorationSet.create(state.doc, decorations);
        },
        handleDOMEvents: {
          dragover(_view, event) {
            if (!event.dataTransfer?.types.includes(SECTION_DRAG_MIME)) return false;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            return true;
          },
          drop(view, event) {
            return dropSection(view, event);
          },
        },
      },
    }),
);

function sectionHandle(position: number, title: string): HTMLElement {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "section-drag-handle";
  handle.draggable = true;
  handle.contentEditable = "false";
  handle.textContent = "⠿";
  handle.setAttribute("aria-label", `Move section: ${title || "Untitled"}`);
  handle.title = "Drag to move this heading and its section";
  handle.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SECTION_DRAG_MIME, String(position));
    event.dataTransfer.setData("text/plain", title);
  });
  return handle;
}

export function dropSection(view: EditorView, event: DragEvent): boolean {
  const raw = event.dataTransfer?.getData(SECTION_DRAG_MIME);
  if (!raw) return false;
  event.preventDefault();
  event.stopPropagation();
  const headingPosition = Number(raw);
  const range = findSectionRange(view.state.doc, headingPosition);
  const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!range || !coordinates) return true;
  const target = findSectionDropTarget(view.state.doc, range, coordinates.pos);
  if (target == null) return true;
  const transaction = moveSection(view.state.tr, range, target);
  if (transaction) view.dispatch(transaction.scrollIntoView());
  return true;
}
