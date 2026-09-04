import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { editorMessages } from "../messages";

export const SECTION_DRAG_MIME = "application/x-markdown-reader-section";

export interface SectionRange {
  from: number;
  to: number;
  level: number;
}

interface SectionDragState {
  range: SectionRange | null;
  target: number | null;
  title: string;
  childHeadings: number;
  invalidReason: string;
}

type SectionDragMeta =
  | { type: "start"; range: SectionRange; title: string; childHeadings: number }
  | { type: "target"; target: number | null; invalidReason: string }
  | { type: "reset" };

const EMPTY_DRAG_STATE: SectionDragState = {
  range: null,
  target: null,
  title: "",
  childHeadings: 0,
  invalidReason: "",
};
const sectionDragKey = new PluginKey<SectionDragState>("MARKDOWN_READER_SECTION_DRAG");

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
      seenHeading
      && node.type.name === "heading"
      && Number(node.attrs.level) <= level
      && to === doc.content.size
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

export function findSectionMoveTarget(
  doc: ProseMirrorNode,
  headingPosition: number,
  direction: -1 | 1,
): number | null {
  const range = findSectionRange(doc, headingPosition);
  if (!range) return null;
  const peerPositions: number[] = [];
  doc.forEach((node, position) => {
    if (node.type.name === "heading" && Number(node.attrs.level) === range.level) {
      peerPositions.push(position);
    }
  });
  const currentIndex = peerPositions.indexOf(headingPosition);
  if (currentIndex < 0) return null;
  if (direction < 0) return peerPositions[currentIndex - 1] ?? null;
  const nextPosition = peerPositions[currentIndex + 1];
  if (nextPosition == null) return null;
  return findSectionRange(doc, nextPosition)?.to ?? null;
}

export function findBlockMoveTarget(
  doc: ProseMirrorNode,
  blockPosition: number,
  direction: -1 | 1,
): number | null {
  const positions: number[] = [];
  doc.forEach((_node, position) => positions.push(position));
  const currentIndex = positions.indexOf(blockPosition);
  if (currentIndex < 0) return null;
  if (direction < 0) return positions[currentIndex - 1] ?? null;
  const nextPosition = positions[currentIndex + 1];
  if (nextPosition == null) return null;
  const next = doc.nodeAt(nextPosition);
  return next ? nextPosition + next.nodeSize : null;
}

export function moveSection(
  transaction: Transaction,
  range: SectionRange,
  dropTarget: number,
): Transaction | null {
  if (
    dropTarget < 0
    || dropTarget > transaction.doc.content.size
    || (dropTarget >= range.from && dropTarget <= range.to)
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

export const sectionDrag = $prose(() => {
  let activeView: EditorView | null = null;
  return new Plugin<SectionDragState>({
    key: sectionDragKey,
    state: {
      init: () => EMPTY_DRAG_STATE,
      apply(transaction, previous) {
        const meta = transaction.getMeta(sectionDragKey) as SectionDragMeta | undefined;
        if (!meta) return previous;
        if (meta.type === "start") {
          return {
            range: meta.range,
            target: null,
            title: meta.title,
            childHeadings: meta.childHeadings,
            invalidReason: "",
          };
        }
        if (meta.type === "target") {
          return { ...previous, target: meta.target, invalidReason: meta.invalidReason };
        }
        return EMPTY_DRAG_STATE;
      },
    },
    view(view) {
      activeView = view;
      return {
        update(nextView) {
          activeView = nextView;
        },
        destroy() {
          activeView = null;
        },
      };
    },
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.forEach((node, position) => {
          if (node.type.name !== "heading") return;
          decorations.push(
            Decoration.widget(
              position,
              () => sectionControls(
                position,
                node.textContent,
                (direction) => moveSectionWithKeyboard(activeView, position, node.textContent, direction),
              ),
              { key: `section-handle-${position}`, side: -1 },
            ),
          );
        });

        const dragState = sectionDragKey.getState(state) ?? EMPTY_DRAG_STATE;
        if (dragState.range) {
          state.doc.forEach((node, position) => {
            if (position < dragState.range!.from || position >= dragState.range!.to) return;
            decorations.push(
              Decoration.node(position, position + node.nodeSize, { class: "section-drag-source" }),
            );
          });
          decorations.push(
            Decoration.widget(
              dragState.range.from,
              () => sectionDragLabel(dragState.title, dragState.childHeadings),
              { key: "section-drag-label", side: -2 },
            ),
          );
          if (dragState.target != null) {
            decorations.push(
              Decoration.widget(
                dragState.target,
                sectionDropIndicator,
                { key: `section-drop-${dragState.target}`, side: -3 },
              ),
            );
          }
        }
        return DecorationSet.create(state.doc, decorations);
      },
      handleKeyDown(view, event) {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return false;
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const { $from } = view.state.selection;
        if ($from.depth < 1) return false;
        const blockPosition = $from.before(1);
        const block = view.state.doc.nodeAt(blockPosition);
        if (!block) return false;
        event.preventDefault();
        if (block.type.name === "heading") {
          moveSectionWithKeyboard(activeView, blockPosition, block.textContent, direction);
          return true;
        }
        const target = findBlockMoveTarget(view.state.doc, blockPosition, direction);
        if (target == null) {
          announce(editorMessages.block.unavailable);
          return true;
        }
        const transaction = moveSection(
          view.state.tr,
          { from: blockPosition, to: blockPosition + block.nodeSize, level: 0 },
          target,
        );
        if (transaction) {
          view.dispatch(transaction.scrollIntoView());
          announce(editorMessages.block.moved);
        }
        return true;
      },
      handleDOMEvents: {
        dragstart(view, event) {
          const handle = closestSectionHandle(event.target);
          if (!handle || !event.dataTransfer) return false;
          const headingPosition = Number(handle.dataset.sectionPosition);
          const range = findSectionRange(view.state.doc, headingPosition);
          if (!range) return false;
          const title = handle.dataset.sectionTitle ?? "";
          const childHeadings = countChildHeadings(view.state.doc, range);
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(SECTION_DRAG_MIME, String(headingPosition));
          event.dataTransfer.setData("text/plain", title);
          handle.dataset.dragging = "true";
          view.dispatch(view.state.tr.setMeta(
            sectionDragKey,
            { type: "start", range, title, childHeadings } satisfies SectionDragMeta,
          ));
          announce(editorMessages.section.moving(title, childHeadings));
          return true;
        },
        dragover(view, event) {
          if (!event.dataTransfer?.types.includes(SECTION_DRAG_MIME)) return false;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          autoScroll(event);
          const dragState = sectionDragKey.getState(view.state);
          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const target = dragState?.range && coordinates
            ? findSectionDropTarget(view.state.doc, dragState.range, coordinates.pos)
            : null;
          const invalidReason = target == null ? editorMessages.section.invalidTarget : "";
          if (target !== dragState?.target || invalidReason !== dragState?.invalidReason) {
            view.dispatch(view.state.tr.setMeta(
              sectionDragKey,
              { type: "target", target, invalidReason } satisfies SectionDragMeta,
            ));
          }
          return true;
        },
        drop(view, event) {
          return dropSection(view, event);
        },
        dragend(view, event) {
          const handle = closestSectionHandle(event.target);
          if (handle) delete handle.dataset.dragging;
          if (sectionDragKey.getState(view.state)?.range) {
            view.dispatch(view.state.tr.setMeta(sectionDragKey, { type: "reset" } satisfies SectionDragMeta));
          }
          return false;
        },
      },
    },
  });
});

function sectionControls(
  position: number,
  title: string,
  onMove: (direction: -1 | 1) => void,
): HTMLElement {
  const controls = document.createElement("span");
  controls.className = "section-drag-controls";
  controls.contentEditable = "false";
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "section-drag-handle";
  handle.draggable = true;
  handle.contentEditable = "false";
  handle.textContent = "⠿";
  handle.dataset.sectionPosition = String(position);
  handle.dataset.sectionTitle = title;
  handle.setAttribute("aria-label", editorMessages.section.move(title));
  handle.setAttribute("aria-expanded", "false");
  handle.title = editorMessages.section.hint;
  handle.addEventListener("click", () => {
    const open = !controls.classList.contains("open");
    controls.classList.toggle("open", open);
    handle.setAttribute("aria-expanded", String(open));
  });
  handle.addEventListener("keydown", (event) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  });
  const actions = document.createElement("span");
  actions.className = "section-move-actions";
  actions.append(
    sectionMoveButton("↑", editorMessages.section.moveUp(title), () => onMove(-1)),
    sectionMoveButton("↓", editorMessages.section.moveDown(title), () => onMove(1)),
  );
  controls.append(handle, actions);
  return controls;
}

function sectionMoveButton(label: string, accessibleName: string, onMove: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "section-move-button";
  button.textContent = label;
  button.setAttribute("aria-label", accessibleName);
  button.title = accessibleName;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onMove();
  });
  return button;
}

function sectionDragLabel(title: string, childHeadings: number): HTMLElement {
  const label = document.createElement("span");
  label.className = "section-drag-label";
  label.textContent = editorMessages.section.moving(title, childHeadings);
  return label;
}

function sectionDropIndicator(): HTMLElement {
  const indicator = document.createElement("div");
  indicator.className = "section-drop-indicator";
  return indicator;
}

function moveSectionWithKeyboard(
  view: EditorView | null,
  headingPosition: number,
  title: string,
  direction: -1 | 1,
): void {
  if (!view) return;
  const range = findSectionRange(view.state.doc, headingPosition);
  const target = findSectionMoveTarget(view.state.doc, headingPosition, direction);
  if (!range || target == null) {
    announce(editorMessages.section.unavailable);
    return;
  }
  const transaction = moveSection(view.state.tr, range, target);
  if (!transaction) return;
  view.dispatch(transaction.scrollIntoView());
  announce(editorMessages.section.moved(title));
}

export function dropSection(view: EditorView, event: DragEvent): boolean {
  const raw = event.dataTransfer?.getData(SECTION_DRAG_MIME);
  if (!raw) return false;
  event.preventDefault();
  event.stopPropagation();
  const dragState = sectionDragKey.getState(view.state);
  const headingPosition = Number(raw);
  const range = dragState?.range ?? findSectionRange(view.state.doc, headingPosition);
  const target = dragState?.target;
  const title = dragState?.title ?? "";
  if (!range || target == null) {
    view.dispatch(view.state.tr.setMeta(sectionDragKey, { type: "reset" } satisfies SectionDragMeta));
    announce(dragState?.invalidReason || editorMessages.section.unavailable);
    return true;
  }
  const transaction = moveSection(view.state.tr, range, target);
  if (transaction) {
    transaction.setMeta(sectionDragKey, { type: "reset" } satisfies SectionDragMeta);
    view.dispatch(transaction.scrollIntoView());
    announce(editorMessages.section.moved(title));
  }
  return true;
}

function countChildHeadings(doc: ProseMirrorNode, range: SectionRange): number {
  let count = 0;
  doc.forEach((node, position) => {
    if (
      position > range.from
      && position < range.to
      && node.type.name === "heading"
      && Number(node.attrs.level) > range.level
    ) count += 1;
  });
  return count;
}

function closestSectionHandle(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element ? target.closest<HTMLButtonElement>(".section-drag-handle") : null;
}

function announce(message: string): void {
  const region = document.querySelector<HTMLElement>("#editorAnnouncement");
  if (region) region.textContent = message;
}

function autoScroll(event: DragEvent): void {
  const threshold = 72;
  const speed = 20;
  if (event.clientY < threshold) window.scrollBy({ top: -speed, behavior: "auto" });
  else if (event.clientY > window.innerHeight - threshold) {
    window.scrollBy({ top: speed, behavior: "auto" });
  }
}
