export interface AutosaveQueueOptions {
  delay: number;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
}

export class AutosaveQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: Promise<boolean> | null = null;
  private paused = false;

  constructor(private readonly options: AutosaveQueueOptions) {}

  schedule(): void {
    if (this.paused) return;
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.options.delay);
  }

  flush(): Promise<boolean> {
    this.clearTimer();
    if (this.paused) return Promise.resolve(false);
    if (!this.active) {
      this.active = this.drain().finally(() => {
        this.active = null;
      });
    }
    return this.active;
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.pause();
  }

  private async drain(): Promise<boolean> {
    while (!this.paused && this.options.isDirty()) {
      if (!(await this.options.save())) return false;
    }
    return !this.paused;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
