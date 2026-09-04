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
import { sectionDrag } from "./extensions/section-drag";
import { mediaPreview } from "./extensions/media-preview";
import { imagePreview } from "./extensions/image-preview";
import { assetMarkdown } from "./media";
import { editorMessages } from "./messages";
import { richBlockEditConfig } from "./slash-menu";
import { slugifyHeading } from "./toc";

export interface RichEditorOptions {
  root: HTMLElement;
  markdown: string;
  documentPath: string;
  onChange: (markdown: string) => void;
  onFiles: (files: File[]) => void;
  onFileDragActive: (active: boolean) => void;
}

export interface InsertedAsset {
  asset: AssetResponse;
  fileName: string;
}

export class RichDocumentEditor {
  private crepe: CrepeBuilder | null = null;
  private suppressChanges = false;
  private onFiles: ((files: File[]) => void) | null = null;
  private onFileDragActive: ((active: boolean) => void) | null = null;
  private dropRoot: HTMLElement | null = null;
  private dragDepth = 0;
  private readonly handleDragEnter = (event: DragEvent) => {
    if (!(event.dataTransfer?.files.length)) return;
    this.dragDepth += 1;
    this.onFileDragActive?.(true);
  };
  private readonly handleDragOver = (event: DragEvent) => {
    if (!(event.dataTransfer?.files.length)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    this.onFileDragActive?.(true);
  };
  private readonly handleDragLeave = (event: DragEvent) => {
    if (!(event.dataTransfer?.types.includes("Files"))) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.onFileDragActive?.(false);
  };
  private readonly handleDrop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragDepth = 0;
    this.onFileDragActive?.(false);
    this.onFiles?.(files);
  };
  private readonly handlePaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.onFiles?.(files);
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
      .addFeature(placeholder, { text: editorMessages.placeholder, mode: "block" })
      .addFeature(toolbar, {
        boldLabel: editorMessages.toolbar.bold,
        italicLabel: editorMessages.toolbar.italic,
        strikethroughLabel: editorMessages.toolbar.strikethrough,
        codeLabel: editorMessages.toolbar.code,
        linkLabel: editorMessages.toolbar.link,
        latexLabel: editorMessages.toolbar.math,
      })
      .addFeature(codeMirror, { languages: [] })
      .addFeature(table)
      .addFeature(latex);
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        this.syncHeadingIds(options.root);
        if (!this.suppressChanges) options.onChange(markdown);
      });
    });
    await crepe.create();
    this.crepe = crepe;
    this.syncHeadingIds(options.root);
    this.onFiles = options.onFiles;
    this.onFileDragActive = options.onFileDragActive;
    this.dropRoot = options.root;
    options.root.addEventListener("dragenter", this.handleDragEnter, true);
    options.root.addEventListener("dragover", this.handleDragOver, true);
    options.root.addEventListener("dragleave", this.handleDragLeave, true);
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

  insertAssets(assets: Iterable<InsertedAsset>): void {
    if (!this.crepe) return;
    const blocks = [...assets].map(({ asset, fileName }) => assetMarkdown(asset, fileName));
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

  focusHeading(anchor: string): boolean {
    let focused = false;
    this.crepe?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const counts = new Map<string, number>();
      view.state.doc.forEach((node, position) => {
        if (focused || node.type.name !== "heading") return;
        const base = slugifyHeading(node.textContent);
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        if (id !== anchor) return;
        const selection = TextSelection.near(view.state.doc.resolve(position + 1), 1);
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        view.focus();
        focused = true;
      });
    });
    return focused;
  }

  async destroy(): Promise<void> {
    const current = this.crepe;
    this.crepe = null;
    this.onFiles = null;
    this.onFileDragActive = null;
    this.dragDepth = 0;
    this.dropRoot?.removeEventListener("dragenter", this.handleDragEnter, true);
    this.dropRoot?.removeEventListener("dragover", this.handleDragOver, true);
    this.dropRoot?.removeEventListener("dragleave", this.handleDragLeave, true);
    this.dropRoot?.removeEventListener("drop", this.handleDrop, true);
    this.dropRoot?.removeEventListener("paste", this.handlePaste, true);
    this.dropRoot = null;
    if (current) await current.destroy();
  }

  private syncHeadingIds(root: HTMLElement): void {
    const counts = new Map<string, number>();
    root.querySelectorAll<HTMLElement>(".ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6")
      .forEach((heading) => {
        const base = slugifyHeading(heading.textContent);
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        heading.dataset.headingId = count === 0 ? base : `${base}-${count}`;
      });
  }
}
