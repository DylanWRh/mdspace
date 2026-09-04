import type { AssetResponse } from "../api/assets";

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface UploadItem {
  id: number;
  generation: number;
  file: File;
  status: UploadStatus;
  error: string;
  upload: () => Promise<AssetResponse>;
  onSuccess: (asset: AssetResponse, file: File) => Promise<void> | void;
}

export interface UploadQueueElements {
  panel: HTMLElement;
  list: HTMLElement;
  summary: HTMLElement;
}

const MAX_ASSET_BYTES = 100 * 1024 * 1024;

export class UploadQueue {
  private items: UploadItem[] = [];
  private nextId = 1;
  private generation = 0;
  private activeIds = new Set<number>();

  constructor(
    private readonly elements: UploadQueueElements,
    private readonly onBusyChange: (busy: boolean) => void,
  ) {
    elements.list.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-upload-retry]")
        : null;
      if (!button) return;
      const item = this.items.find((candidate) => candidate.id === Number(button.dataset.uploadRetry));
      if (item) void this.runItem(item);
    });
  }

  async enqueue(
    files: Iterable<File>,
    upload: (file: File) => Promise<AssetResponse>,
    onSuccess: (asset: AssetResponse, file: File) => Promise<void> | void,
  ): Promise<void> {
    const incoming = [...files];
    if (!incoming.length) return;
    const batch = incoming.map<UploadItem>((file) => ({
      id: this.nextId++,
      generation: this.generation,
      file,
      status: "queued",
      error: file.size > MAX_ASSET_BYTES ? "文件超过 100 MiB" : "",
      upload: () => upload(file),
      onSuccess,
    }));
    for (const item of batch) {
      if (item.error) item.status = "error";
      this.items.push(item);
    }
    this.render();
    for (const item of batch) {
      if (item.status !== "error") await this.runItem(item);
    }
  }

  reset(): void {
    this.generation += 1;
    this.items = [];
    this.activeIds.clear();
    this.onBusyChange(false);
    this.render();
  }

  private async runItem(item: UploadItem): Promise<void> {
    if (item.status === "uploading") return;
    item.status = "uploading";
    item.error = "";
    this.activeIds.add(item.id);
    this.onBusyChange(true);
    this.render();
    try {
      const asset = await item.upload();
      if (item.generation !== this.generation) return;
      await item.onSuccess(asset, item.file);
      item.status = "done";
    } catch (error) {
      item.status = "error";
      item.error = error instanceof Error ? error.message : "上传失败";
    } finally {
      this.activeIds.delete(item.id);
      this.onBusyChange(this.activeIds.size > 0);
      this.render();
    }
  }

  private render(): void {
    const { panel, list, summary } = this.elements;
    panel.hidden = this.items.length === 0;
    list.replaceChildren();
    const counts = this.items.reduce(
      (result, item) => ({ ...result, [item.status]: result[item.status] + 1 }),
      { queued: 0, uploading: 0, done: 0, error: 0 },
    );
    summary.textContent = counts.error
      ? `${counts.done} 个完成，${counts.error} 个失败`
      : counts.uploading || counts.queued
        ? `${counts.done}/${this.items.length} 个完成`
        : `${counts.done} 个文件已插入`;
    for (const item of this.items) list.append(this.itemElement(item));
  }

  private itemElement(item: UploadItem): HTMLElement {
    const row = document.createElement("div");
    row.className = `upload-item ${item.status}`;
    const copy = document.createElement("span");
    copy.className = "upload-item-copy";
    const name = document.createElement("strong");
    name.textContent = item.file.name;
    const detail = document.createElement("span");
    detail.textContent = item.status === "queued"
      ? "等待上传"
      : item.status === "uploading"
        ? "正在上传…"
        : item.status === "done"
          ? "已保存并插入"
          : item.error || "上传失败";
    copy.append(name, detail);
    row.append(copy);
    if (item.status === "uploading") {
      const spinner = document.createElement("span");
      spinner.className = "upload-spinner";
      spinner.setAttribute("aria-hidden", "true");
      row.append(spinner);
    }
    if (item.status === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.dataset.uploadRetry = String(item.id);
      retry.textContent = "重试";
      row.append(retry);
    }
    return row;
  }
}
