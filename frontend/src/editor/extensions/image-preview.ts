import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";

import { rawAssetUrl } from "../../app/paths";

export function imagePreview(documentPath: string) {
  return $view(imageSchema.node, () => (node) => imageNodeView(node, documentPath));
}

function imageNodeView(initialNode: ProseMirrorNode, documentPath: string): NodeView {
  const dom = document.createElement("img");
  const update = (node: ProseMirrorNode): boolean => {
    if (node.type !== initialNode.type) return false;
    const source = typeof node.attrs.src === "string" ? node.attrs.src : "";
    dom.src = rawAssetUrl(documentPath, source);
    dom.alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
    dom.title = typeof node.attrs.title === "string" ? node.attrs.title : "";
    dom.draggable = true;
    return true;
  };
  update(initialNode);
  return { dom, update };
}
