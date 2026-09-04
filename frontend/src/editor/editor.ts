import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { imageBlock } from "@milkdown/crepe/feature/image-block";
import { latex } from "@milkdown/crepe/feature/latex";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { insert, replaceAll } from "@milkdown/kit/utils";

import type { AssetResponse } from "../api/assets";
import { rawAssetUrl } from "../app/paths";
import { assetMarkdown } from "./media";
import { sectionDrag } from "./extensions/section-drag";

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
    if ([...(event.dataTransfer?.files ?? [])].some((file) => !file.type.startsWith("image/"))) {
      event.preventDefault();
    }
  };
  private readonly handleDrop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.some((file) => !file.type.startsWith("image/"))) return;
    event.preventDefault();
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
    crepe
      .addFeature(cursor)
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(imageBlock, {
        onUpload: async (file) => (await options.uploadFile(file)).relativePath,
        proxyDomURL: (url) => rawAssetUrl(options.documentPath, url),
        inlineUploadButton: "Upload image",
        blockUploadButton: "Upload image",
        blockCaptionPlaceholderText: "Image caption",
      })
      .addFeature(blockEdit, {
        textGroup: { label: "Text" },
        listGroup: { label: "Lists" },
        advancedGroup: { label: "Insert" },
      })
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
    options.root.addEventListener("dragover", this.handleDragOver);
    options.root.addEventListener("drop", this.handleDrop);

    options.root.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
      const source = image.getAttribute("src");
      if (source) image.src = rawAssetUrl(options.documentPath, source);
    });
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
    for (const file of files) {
      const asset = await this.uploadFile(file);
      this.crepe.editor.action(insert(`${assetMarkdown(asset, file.name)}\n`));
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
    this.dropRoot?.removeEventListener("dragover", this.handleDragOver);
    this.dropRoot?.removeEventListener("drop", this.handleDrop);
    this.dropRoot = null;
    if (current) await current.destroy();
  }
}
