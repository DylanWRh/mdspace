import { describe, expect, it, vi } from "vitest";

import { AutosaveQueue } from "./save";

describe("AutosaveQueue", () => {
  it("debounces routine saves", async () => {
    vi.useFakeTimers();
    let dirty = true;
    const save = vi.fn(async () => {
      dirty = false;
      return true;
    });
    const queue = new AutosaveQueue({ delay: 1000, isDirty: () => dirty, save });
    queue.schedule();
    queue.schedule();
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("serializes and drains edits made during a save", async () => {
    let revision = 1;
    let savedRevision = 0;
    let releaseFirst: (() => void) | undefined;
    const save = vi.fn(async () => {
      const submitted = revision;
      if (submitted === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
      savedRevision = submitted;
      return true;
    });
    const queue = new AutosaveQueue({
      delay: 0,
      isDirty: () => savedRevision !== revision,
      save,
    });
    const flushing = queue.flush();
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    revision = 2;
    releaseFirst?.();
    await flushing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(savedRevision).toBe(2);
  });

  it("stops when paused by a conflict", async () => {
    const save = vi.fn(async () => false);
    const queue = new AutosaveQueue({ delay: 0, isDirty: () => true, save });
    queue.pause();
    expect(await queue.flush()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("cancels a scheduled save without disabling manual flushes", async () => {
    vi.useFakeTimers();
    let dirty = true;
    const save = vi.fn(async () => {
      dirty = false;
      return true;
    });
    const queue = new AutosaveQueue({ delay: 1000, isDirty: () => dirty, save });
    queue.schedule();
    queue.cancelScheduled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(await queue.flush()).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
