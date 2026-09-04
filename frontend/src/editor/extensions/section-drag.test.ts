import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { history, redo, undo } from "@milkdown/kit/prose/history";
import { describe, expect, it } from "vitest";

import {
  findBlockMoveTarget,
  findSectionDropTarget,
  findSectionMoveTarget,
  findSectionRange,
  moveSection,
} from "./section-drag";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
  },
});

const heading = (level: number, text: string) =>
  schema.nodes.heading.create({ level }, schema.text(text));
const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));

function fixture() {
  return schema.nodes.doc.create(null, [
    heading(2, "A"),
    paragraph("P1"),
    heading(3, "B"),
    paragraph("P2"),
    heading(2, "C"),
    paragraph("P3"),
  ]);
}

function positions(doc = fixture()) {
  const result: number[] = [];
  doc.forEach((_node, position) => result.push(position));
  return result;
}

function labels(state: EditorState): string[] {
  const result: string[] = [];
  state.doc.forEach((node) => result.push(node.textContent));
  return result;
}

describe("section ranges", () => {
  it("includes nested headings until the next peer heading", () => {
    const doc = fixture();
    const [a, , b, , c] = positions(doc);
    expect(findSectionRange(doc, a)).toEqual({ from: a, to: c, level: 2 });
    expect(findSectionRange(doc, b)).toEqual({
      from: b,
      to: c,
      level: 3,
    });
  });

  it("handles adjacent, empty, and final sections", () => {
    const doc = schema.nodes.doc.create(null, [
      heading(1, "A"),
      heading(2, "B"),
      heading(1, "C"),
    ]);
    const [a, b, c] = positions(doc);
    expect(findSectionRange(doc, a)?.to).toBe(c);
    expect(findSectionRange(doc, b)?.to).toBe(c);
    expect(findSectionRange(doc, c)?.to).toBe(doc.content.size);
  });

  it("rejects drops inside the moving section", () => {
    const doc = fixture();
    const [a, paragraphPosition, , , c] = positions(doc);
    const range = findSectionRange(doc, a)!;
    expect(findSectionDropTarget(doc, range, paragraphPosition + 1)).toBeNull();
    expect(findSectionDropTarget(doc, range, c)).toBeNull();
  });
});

describe("section movement", () => {
  it("finds keyboard targets around peer sections", () => {
    const doc = fixture();
    const [a, , , , c] = positions(doc);
    expect(findSectionMoveTarget(doc, a, -1)).toBeNull();
    expect(findSectionMoveTarget(doc, a, 1)).toBe(doc.content.size);
    expect(findSectionMoveTarget(doc, c, -1)).toBe(a);
    expect(findSectionMoveTarget(doc, c, 1)).toBeNull();
  });

  it("finds keyboard targets for individual top-level blocks", () => {
    const doc = fixture();
    const [a, p1, b] = positions(doc);
    expect(findBlockMoveTarget(doc, a, -1)).toBeNull();
    expect(findBlockMoveTarget(doc, p1, -1)).toBe(a);
    expect(findBlockMoveTarget(doc, p1, 1)).toBe(b + doc.nodeAt(b)!.nodeSize);
  });

  it("moves a whole section downward in one transaction", () => {
    const doc = fixture();
    const [a] = positions(doc);
    const range = findSectionRange(doc, a)!;
    const state = EditorState.create({ schema, doc });
    const transaction = moveSection(state.tr, range, doc.content.size)!;
    const moved = state.apply(transaction);
    expect(labels(moved)).toEqual(["C", "P3", "A", "P1", "B", "P2"]);
  });

  it("moves a nested section upward", () => {
    const doc = fixture();
    const [, , b] = positions(doc);
    const state = EditorState.create({ schema, doc });
    const moved = state.apply(moveSection(state.tr, findSectionRange(doc, b)!, 0)!);
    expect(labels(moved)).toEqual(["B", "P2", "A", "P1", "C", "P3"]);
  });

  it("participates in ProseMirror undo and redo", () => {
    const doc = fixture();
    const [a] = positions(doc);
    let state = EditorState.create({ schema, doc, plugins: [history()] });
    state = state.apply(moveSection(state.tr, findSectionRange(doc, a)!, doc.content.size)!);
    const movedLabels = labels(state);
    undo(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(labels(state)).toEqual(["A", "P1", "B", "P2", "C", "P3"]);
    redo(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(labels(state)).toEqual(movedLabels);
  });
});
