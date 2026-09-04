import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { latex } from "@milkdown/crepe/feature/latex";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { replaceAll } from "@milkdown/kit/utils";

import type { AssetResponse } from "../api/assets";
import { assetMarkdown } from "./media";
import { sectionDrag } from "./extensions/section-drag";
import { mediaPreview } from "./extensions/media-preview";
import { imagePreview } from "./extensions/image-preview";
import { richBlockEditConfig } from "./slash-menu";

export interface RichEditorOptions {
  root: HTMLElement;
  markdown: string;
  documentPath: string;
  onChange: (markdown: string) => void;
  uploadFile: (file: File) => Promise<AssetResponse>;
}

export class RichDocumentEditor {
  private crepe: CrepeBuilder | null = null;
  private suppressChanges = false;
  private uploadFile: ((file: File) => Promise<AssetResponse>) | null = null;
  private dropRoot: HTMLElement | null = null;
  private readonly handleDragOver = (event: DragEvent) => {
    if (!(event.dataTransfer?.files.length)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  private readonly handleDrop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void this.insertFiles(files);
  };
  private readonly handlePaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void this.insertFiles(files);
  };

  async mount(options: RichEditorOptions): Promise<void> {
    await this.destroy();
    options.root.replaceChildren();
    const crepe = new CrepeBuilder({
      root: options.root,
      defaultValue: options.markdown,
    });
    crepe.editor.use(sectionDrag);
    crepe.editor.use(mediaPreview(options.documentPath));
    crepe.editor.use(imagePreview(options.documentPath));
    crepe
      .addFeature(cursor)
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(blockEdit, richBlockEditConfig)
      .addFeature(placeholder, { text: "Type / for commands", mode: "block" })
      .addFeature(toolbar)
      .addFeature(codeMirror, { languages: [] })
      .addFeature(table)
      .addFeature(latex);
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (!this.suppressChanges) options.onChange(markdown);
      });
    });
    await crepe.create();
    this.crepe = crepe;
    this.uploadFile = options.uploadFile;
    this.dropRoot = options.root;
    options.root.addEventListener("dragover", this.handleDragOver, true);
    options.root.addEventListener("drop", this.handleDrop, true);
    options.root.addEventListener("paste", this.handlePaste, true);
  }

  getMarkdown(): string {
    return this.crepe?.getMarkdown() ?? "";
  }

  setMarkdown(markdown: string): void {
    if (!this.crepe) return;
    this.suppressChanges = true;
    this.crepe.editor.action(replaceAll(markdown, true));
    this.suppressChanges = false;
  }

  async insertFiles(files: Iterable<File>): Promise<void> {
    if (!this.crepe || !this.uploadFile) return;
    const blocks: string[] = [];
    for (const file of files) {
      const asset = await this.uploadFile(file);
      blocks.push(assetMarkdown(asset, file.name));
    }
    if (blocks.length) this.insertMarkdownBlocks(`${blocks.join("\n\n")}\n`);
  }

  private insertMarkdownBlocks(markdown: string): void {
    const before = this.getMarkdown();
    this.crepe?.editor.action((ctx) => {
      const parsed = ctx.get(parserCtx)(markdown);
      if (!parsed) return;
      const view = ctx.get(editorViewCtx);
      const { $to } = view.state.selection;
      const position = $to.depth > 0 ? $to.after(1) : $to.pos;
      let transaction = view.state.tr.insert(position, parsed.content);
      transaction = transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(position + parsed.content.size), -1),
      );
      view.dispatch(transaction.scrollIntoView());
    });
    if (this.getMarkdown() === before) {
      const next = `${before.trimEnd()}\n\n${markdown.trim()}\n`;
      this.crepe?.editor.action(replaceAll(next, true));
    }
  }

  focus(): void {
    const editor = document.querySelector<HTMLElement>(".milkdown .ProseMirror");
    editor?.focus();
  }

  async destroy(): Promise<void> {
    const current = this.crepe;
    this.crepe = null;
    this.uploadFile = null;
    this.dropRoot?.removeEventListener("dragover", this.handleDragOver, true);
    this.dropRoot?.removeEventListener("drop", this.handleDrop, true);
    this.dropRoot?.removeEventListener("paste", this.handlePaste, true);
    this.dropRoot = null;
    if (current) await current.destroy();
  }
}
