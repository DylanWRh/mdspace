import type { BlockEditFeatureConfig } from "@milkdown/crepe/feature/block-edit";
import { commandsCtx } from "@milkdown/kit/core";
import {
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  setBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";

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
  textGroup: {
    label: "Text",
    text: { label: "Text" },
    h1: { label: "H1 · Heading 1" },
    h2: { label: "H2 · Heading 2" },
    h3: { label: "H3 · Heading 3" },
    quote: { label: "Quote" },
    divider: { label: "Divider" },
  },
  listGroup: {
    label: "Lists",
    bulletList: { label: "Bulleted List" },
    orderedList: { label: "Numbered List" },
    taskList: { label: "Todo / Task List" },
  },
  advancedGroup: {
    label: "Insert",
    image: null,
    codeBlock: { label: "Code Block" },
    table: { label: "Table" },
    math: { label: "Math Equation" },
  },
  buildMenu(builder) {
    const advanced = builder.getGroup("advanced");
    advanced.addItem("image", {
      label: "Image",
      icon: imageIcon,
      onRun: (ctx) => {
        ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
        document.querySelector<HTMLInputElement>("#assetInput")?.click();
      },
    });
    advanced.addItem("mermaid", {
      label: "Mermaid Diagram",
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
