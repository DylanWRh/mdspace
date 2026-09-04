import type { BlockEditFeatureConfig } from "@milkdown/crepe/feature/block-edit";
import { commandsCtx } from "@milkdown/kit/core";
import {
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  setBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";

import { editorMessages } from "./messages";

const mermaidIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="7" height="5" rx="1" />
    <rect x="14" y="15" width="7" height="5" rx="1" />
    <path d="M10 6.5h4a3 3 0 0 1 3 3V15M12 12l2-2 2 2" />
  </svg>`;

const imageIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m5 18 5-5 3 3 2-2 4 4" />
  </svg>`;

export const richBlockEditConfig: BlockEditFeatureConfig = {
  blockHandle: {
    getPlacement: () => window.matchMedia("(max-width: 720px)").matches
      ? "top-start"
      : "left-start",
    getOffset: () => window.matchMedia("(max-width: 720px)").matches ? 6 : 12,
  },
  slashMenu: {
    offset: 12,
  },
  textGroup: {
    label: editorMessages.menu.textGroup,
    text: { label: editorMessages.menu.text },
    h1: { label: `H1 · ${editorMessages.menu.heading1}` },
    h2: { label: `H2 · ${editorMessages.menu.heading2}` },
    h3: { label: `H3 · ${editorMessages.menu.heading3}` },
    quote: { label: editorMessages.menu.quote },
    divider: { label: editorMessages.menu.divider },
  },
  listGroup: {
    label: editorMessages.menu.listGroup,
    bulletList: { label: editorMessages.menu.bulletList },
    orderedList: { label: editorMessages.menu.orderedList },
    taskList: { label: editorMessages.menu.taskList },
  },
  advancedGroup: {
    label: editorMessages.menu.insertGroup,
    image: null,
    codeBlock: { label: editorMessages.menu.codeBlock },
    table: { label: editorMessages.menu.table },
    math: { label: editorMessages.menu.math },
  },
  buildMenu(builder) {
    const advanced = builder.getGroup("advanced");
    advanced.addItem("image", {
      label: editorMessages.menu.image,
      icon: imageIcon,
      onRun: (ctx) => {
        ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
        document.querySelector<HTMLInputElement>("#assetInput")?.click();
      },
    });
    advanced.addItem("mermaid", {
      label: editorMessages.menu.mermaid,
      icon: mermaidIcon,
      onRun: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, {
          nodeType: codeBlockSchema.type(ctx),
          attrs: { language: "mermaid" },
        });
      },
    });
  },
};
