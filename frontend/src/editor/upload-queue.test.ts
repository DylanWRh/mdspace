// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetResponse } from "../api/assets";
import { UploadQueue } from "./upload-queue";

function fixture() {
  document.body.innerHTML = `
    <section id="panel" hidden>
      <span id="summary"></span>
      <div id="list"></div>
    </section>`;
  const onBusyChange = vi.fn();
  const queue = new UploadQueue({
    panel: document.querySelector<HTMLElement>("#panel")!,
    summary: document.querySelector<HTMLElement>("#summary")!,
    list: document.querySelector<HTMLElement>("#list")!,
  }, onBusyChange);
  return { queue, onBusyChange };
}

const asset: AssetResponse = {
  path: "assets/figure.png",
  kind: "image",
  mediaType: "image/png",
  name: "figure.png",
  relativePath: "./assets/figure.png",
  size: 5,
};

describe("UploadQueue", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders progress and a successful insertion", async () => {
    const { queue, onBusyChange } = fixture();
    const insert = vi.fn();
    await queue.enqueue(
      [new File(["image"], "figure.png", { type: "image/png" })],
      async () => asset,
      insert,
    );
    expect(document.querySelector<HTMLElement>("#panel")?.hidden).toBe(false);
    expect(document.querySelector("#summary")?.textContent).toContain("1 个文件已插入");
    expect(document.querySelector(".upload-item.done")?.textContent).toContain("已保存并插入");
    expect(insert).toHaveBeenCalledOnce();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("does not insert an upload after the queue has been reset", async () => {
    const { queue } = fixture();
    let release: ((value: AssetResponse) => void) | undefined;
    const upload = vi.fn(() => new Promise<AssetResponse>((resolve) => { release = resolve; }));
    const insert = vi.fn();
    const pending = queue.enqueue([new File(["image"], "late.png")], upload, insert);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    queue.reset();
    release?.(asset);
    await pending;
    expect(insert).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>("#panel")?.hidden).toBe(true);
  });

  it("keeps a failed upload visible and retries it", async () => {
    const { queue } = fixture();
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(asset);
    const insert = vi.fn();
    await queue.enqueue([new File(["image"], "retry.png")], upload, insert);
    expect(document.querySelector(".upload-item.error")?.textContent).toContain("网络中断");

    document.querySelector<HTMLButtonElement>("[data-upload-retry]")?.click();
    await vi.waitFor(() => expect(insert).toHaveBeenCalledOnce());
    expect(document.querySelector(".upload-item.done")?.textContent).toContain("已保存并插入");
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
