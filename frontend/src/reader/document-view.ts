import type { ReaderElements } from "./dom";
import type { DocumentFolding } from "./folding";
import { getJSON } from "./http";
import type { PreviewResponse, ReaderMode, TocItem } from "./types";

export interface DocumentViewOptions {
  elements: ReaderElements;
  folding: DocumentFolding;
  mode: () => ReaderMode;
  currentPath: () => string;
  navigate: (path: string, anchor?: string) => void;
  showToast: (message: string) => void;
}

export class DocumentView {
  private observer: IntersectionObserver | null = null;
  private previewTimer: number | null = null;
  private hidePreviewTimer: number | null = null;
  private previewController: AbortController | null = null;

  constructor(private readonly options: DocumentViewOptions) {}

  bindDocumentInteractions(): void {
    const { content, preview } = this.options.elements;
    content.addEventListener("click", (event) => {
      const link = closest<HTMLAnchorElement>(event.target, "a");
      if (!link) return;
      if (
        link.classList.contains("cross-document-link")
        && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      ) {
        event.preventDefault();
        const path = link.dataset.docPath;
        if (path) this.options.navigate(path, link.dataset.anchor ?? "");
      } else if (link.classList.contains("anchor-link")) {
        event.preventDefault();
        this.scrollToAnchor(link.dataset.anchor ?? link.hash.slice(1), true);
      }
    });

    content.addEventListener("pointerover", (event) => {
      if (event.pointerType === "touch") return;
      const link = closest<HTMLAnchorElement>(event.target, "a.document-link");
      if (!link || containsTarget(link, event.relatedTarget)) return;
      this.clearHidePreviewTimer();
      this.clearPreviewTimer();
      this.previewTimer = window.setTimeout(() => void this.showPreview(link), 360);
    });

    content.addEventListener("pointerout", (event) => {
      const link = closest<HTMLAnchorElement>(event.target, "a.document-link");
      if (!link || containsTarget(link, event.relatedTarget)) return;
      this.clearPreviewTimer();
      this.hidePreviewTimer = window.setTimeout(() => this.hidePreview(), 220);
    });
    preview.addEventListener("pointerenter", () => this.clearHidePreviewTimer());
    preview.addEventListener("pointerleave", () => {
      this.hidePreviewTimer = window.setTimeout(() => this.hidePreview(), 160);
    });
  }

  resetForNavigation(): void {
    const { elements, folding } = this.options;
    this.hidePreview(true);
    elements.status.hidden = false;
    elements.status.classList.remove("error");
    elements.status.innerHTML = '<span class="loading-spinner"></span><span>正在打开文档…</span>';
    elements.content.innerHTML = "";
    elements.footer.hidden = true;
    this.observer?.disconnect();
    folding.reset();
  }

  renderToc(items: TocItem[]): void {
    const { toc } = this.options.elements;
    toc.replaceChildren();
    if (!items.length) {
      toc.innerHTML = '<span class="tree-empty">本文没有标题</span>';
      return;
    }
    const minLevel = Math.min(...items.map((item) => item.level));
    for (const item of items) {
      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = `#${encodeURIComponent(item.id)}`;
      link.dataset.headingId = item.id;
      link.style.setProperty("--indent", `${Math.min(item.level - minLevel, 3) * 12}px`);
      link.textContent = item.title;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.scrollToAnchor(item.id, true);
      });
      toc.append(link);
    }
    this.observeHeadings(items);
  }

  renderBreadcrumbs(path: string, projectName: string): void {
    const parts = path ? path.split("/") : [];
    const nodes = [projectName, ...parts];
    this.options.elements.breadcrumbs.replaceChildren(
      ...nodes.flatMap((part, index) => {
        const result: Node[] = [];
        if (index) {
          const separator = document.createElement("span");
          separator.className = "breadcrumb-chevron";
          separator.textContent = "/";
          result.push(separator);
        }
        const label = document.createElement("span");
        label.className = "breadcrumb-part";
        label.title = part;
        label.textContent = part;
        result.push(label);
        return result;
      }),
    );
  }

  scrollToAnchor(anchor: string, updateHistory = false): void {
    if (!anchor) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const { elements, folding } = this.options;
    const scope = this.options.mode() === "edit"
      ? document.querySelector<HTMLElement>("#richEditor")
      : elements.content;
    if (!scope) return;
    let target = scope.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`);
    if (!target) {
      const decoded = decodeURIComponent(anchor).toLocaleLowerCase();
      target = [...scope.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")]
        .find((heading) => heading.textContent.trim().toLocaleLowerCase() === decoded) ?? null;
    }
    if (!target) return;
    if (this.options.mode() !== "edit") folding.revealFor(target);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (updateHistory) {
      const currentPath = this.options.currentPath();
      history.replaceState(
        { path: currentPath },
        "",
        `/?file=${encodeURIComponent(currentPath)}#${encodeURIComponent(target.id)}`,
      );
    }
  }

  async enhanceDocument(): Promise<void> {
    const { content } = this.options.elements;
    content.querySelectorAll<HTMLButtonElement>(".copy-code").forEach((button) => {
      button.addEventListener("click", async () => {
        const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
        try {
          await navigator.clipboard.writeText(code);
          button.textContent = "Copied";
          window.setTimeout(() => { button.textContent = "Copy"; }, 1400);
        } catch {
          this.options.showToast("无法访问剪贴板");
        }
      });
    });

    content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.addEventListener("click", () => this.openLightbox(image));
    });

    if (window.mermaid) {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#eaf0ff",
            primaryTextColor: "#1f2329",
            primaryBorderColor: "#7aa2ff",
            lineColor: "#697386",
            secondaryColor: "#f4f6f8",
            tertiaryColor: "#ffffff",
            fontFamily: "Inter, PingFang SC, Microsoft YaHei, sans-serif",
          },
          flowchart: { htmlLabels: true, curve: "basis" },
        });
        const diagrams = [...content.querySelectorAll<HTMLElement>("pre.mermaid")];
        if (diagrams.length) {
          await window.mermaid.run({ nodes: diagrams, suppressErrors: true });
          diagrams.forEach((diagram) => {
            const shell = diagram.closest<HTMLElement>(".diagram-shell");
            if (shell) shell.dataset.diagramState = "ready";
          });
        }
      } catch (error) {
        console.warn("Mermaid rendering failed", error);
        content.querySelectorAll<HTMLElement>(".diagram-shell[data-diagram-state='pending']")
          .forEach((shell) => { shell.dataset.diagramState = "error"; });
      }
    }

    if (window.MathJax?.typesetPromise) {
      try {
        await window.MathJax.typesetPromise([content]);
      } catch (error) {
        console.warn("Math rendering failed", error);
      }
    }
  }

  hidePreview(immediate = false): void {
    this.clearPreviewTimer();
    this.clearHidePreviewTimer();
    if (immediate) this.previewController?.abort();
    this.options.elements.preview.hidden = true;
  }

  closeLightbox(): void {
    const { lightbox } = this.options.elements;
    lightbox.hidden = true;
    lightbox.querySelector<HTMLImageElement>("img")?.removeAttribute("src");
    document.body.style.overflow = "";
  }

  updateProgress(): void {
    const { content, progress } = this.options.elements;
    const documentTop = content.offsetTop;
    const total = Math.max(1, content.offsetHeight - window.innerHeight + 100);
    const ratio = Math.max(0, Math.min(1, (window.scrollY - documentTop + 90) / total));
    progress.style.width = `${ratio * 100}%`;
  }

  private observeHeadings(items: TocItem[]): void {
    this.observer?.disconnect();
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => heading instanceof HTMLElement);
    this.observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
      let id = (visible[0]?.target as HTMLElement | undefined)?.id;
      if (!id) {
        const above = headings.filter((heading) => heading.getBoundingClientRect().top < 100);
        id = above.at(-1)?.id ?? headings[0]?.id;
      }
      if (!id) return;
      this.options.elements.toc.querySelectorAll<HTMLElement>(".toc-link").forEach((link) => {
        link.classList.toggle("active", link.dataset.headingId === id);
      });
      this.options.elements.toc.querySelector<HTMLElement>(".toc-link.active")
        ?.scrollIntoView({ block: "nearest" });
    }, { rootMargin: "-76px 0px -68% 0px", threshold: [0, 1] });
    headings.forEach((heading) => this.observer?.observe(heading));
  }

  private async showPreview(link: HTMLAnchorElement): Promise<void> {
    const { preview, previewPath, previewContent } = this.options.elements;
    const path = link.dataset.docPath ?? this.options.currentPath();
    const anchor = link.dataset.anchor ?? "";
    this.previewController?.abort();
    this.previewController = new AbortController();
    previewPath.textContent = path;
    previewContent.innerHTML = '<div class="document-status"><span class="loading-spinner"></span></div>';
    preview.hidden = false;
    this.positionPreview(link);
    try {
      const data = await getJSON<PreviewResponse>(
        `/api/preview?path=${encodeURIComponent(path)}&anchor=${encodeURIComponent(anchor)}`,
        { signal: this.previewController.signal },
      );
      previewPath.textContent = data.path;
      previewContent.innerHTML = data.html;
      this.positionPreview(link);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) this.hidePreview(true);
    }
  }

  private positionPreview(link: HTMLAnchorElement): void {
    const { preview } = this.options.elements;
    const rect = link.getBoundingClientRect();
    const width = Math.min(430, window.innerWidth - 24);
    const previewHeight = Math.min(480, preview.scrollHeight || 260);
    let left = rect.left + Math.min(rect.width, 30);
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    let top = rect.bottom + 9;
    if (top + previewHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - previewHeight - 9);
    }
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }

  private openLightbox(source: HTMLImageElement): void {
    const { lightbox } = this.options.elements;
    const image = lightbox.querySelector<HTMLImageElement>("img");
    if (!image) return;
    image.src = source.currentSrc || source.src;
    image.alt = source.alt || "图片预览";
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  private clearHidePreviewTimer(): void {
    if (this.hidePreviewTimer !== null) window.clearTimeout(this.hidePreviewTimer);
    this.hidePreviewTimer = null;
  }
}

function closest<T extends Element>(target: EventTarget | null, selector: string): T | null {
  return target instanceof Element ? target.closest<T>(selector) : null;
}

function containsTarget(element: Element, target: EventTarget | null): boolean {
  return target instanceof Node && element.contains(target);
}
