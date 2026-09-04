interface SectionStackEntry {
  level: number;
  heading: HTMLHeadingElement;
}

interface FoldListEntry {
  item: HTMLLIElement;
  toggle: HTMLButtonElement;
  content: HTMLElement[];
  id: string;
  title: string;
}

const foldableSelector = "ul,ol,p,blockquote,pre,table,figure,.code-block,.diagram-shell,.math.block";

export class DocumentFolding {
  private readonly collapsedSections = new Map<string, Set<string>>();
  private readonly collapsedListItems = new Map<string, Set<string>>();
  private sectionAncestors = new WeakMap<HTMLElement, string[]>();
  private foldHeadings: HTMLHeadingElement[] = [];
  private foldListItems: FoldListEntry[] = [];

  constructor(
    private readonly content: HTMLElement,
    private readonly toc: HTMLElement,
    private readonly toggleAllButton: HTMLButtonElement,
    private readonly documentKey: () => string,
    private readonly updateProgress: () => void,
  ) {}

  reset(): void {
    this.foldHeadings = [];
    this.sectionAncestors = new WeakMap();
    this.foldListItems = [];
    this.toggleAllButton.disabled = true;
  }

  setup(): void {
    this.setupSections();
    this.setupLists();
  }

  toggleAllSections(): void {
    const collapsed = this.currentSectionState();
    const allCollapsed = this.foldHeadings.length > 0
      && this.foldHeadings.every((heading) => collapsed.has(heading.id));
    if (allCollapsed) collapsed.clear();
    else this.foldHeadings.forEach((heading) => collapsed.add(heading.id));
    this.applySectionFolding();
  }

  revealFor(target: Element): void {
    this.revealSectionFor(target);
    this.revealListFor(target);
  }

  private currentSectionState(): Set<string> {
    const key = this.documentKey();
    let state = this.collapsedSections.get(key);
    if (!state) {
      state = new Set();
      this.collapsedSections.set(key, state);
    }
    return state;
  }

  private currentListState(): Set<string> {
    const key = this.documentKey();
    let state = this.collapsedListItems.get(key);
    if (!state) {
      state = new Set();
      this.collapsedListItems.set(key, state);
    }
    return state;
  }

  private applySectionFolding(): void {
    const collapsed = this.currentSectionState();
    for (const element of this.content.children) {
      if (!(element instanceof HTMLElement)) continue;
      const owners = this.sectionAncestors.get(element) ?? [];
      element.classList.toggle(
        "section-hidden",
        owners.some((id) => collapsed.has(id)),
      );
    }

    for (const heading of this.foldHeadings) {
      const folded = collapsed.has(heading.id);
      heading.classList.toggle("section-collapsed", folded);
      const toggle = heading.querySelector<HTMLButtonElement>(":scope > .section-toggle");
      if (toggle) {
        toggle.setAttribute("aria-expanded", String(!folded));
        const action = folded ? "展开" : "折叠";
        toggle.title = `${action}此章节`;
        toggle.setAttribute("aria-label", `${action}章节：${heading.dataset.sectionTitle ?? ""}`);
      }
      const tocLink = this.toc.querySelector<HTMLElement>(
        `[data-heading-id="${CSS.escape(heading.id)}"]`,
      );
      tocLink?.classList.toggle("section-collapsed", folded);
    }

    const allCollapsed = this.foldHeadings.length > 0
      && this.foldHeadings.every((heading) => collapsed.has(heading.id));
    this.toggleAllButton.disabled = this.foldHeadings.length === 0;
    this.toggleAllButton.classList.toggle("all-collapsed", allCollapsed);
    this.toggleAllButton.title = allCollapsed ? "展开全部章节" : "折叠全部章节";
    this.toggleAllButton.setAttribute("aria-label", this.toggleAllButton.title);
    this.toggleAllButton.setAttribute("aria-pressed", String(allCollapsed));
    requestAnimationFrame(this.updateProgress);
  }

  private toggleSection(heading: HTMLHeadingElement): void {
    const collapsed = this.currentSectionState();
    if (collapsed.has(heading.id)) collapsed.delete(heading.id);
    else collapsed.add(heading.id);
    this.applySectionFolding();
  }

  private setupSections(): void {
    const collapsed = this.currentSectionState();
    const elements = [...this.content.children].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const stack: SectionStackEntry[] = [];
    const headings: HTMLHeadingElement[] = [];
    this.sectionAncestors = new WeakMap();

    for (const element of elements) {
      if (element.matches("h1.document-heading,h2.document-heading,h3.document-heading,h4.document-heading,h5.document-heading,h6.document-heading")) {
        const heading = element as HTMLHeadingElement;
        const level = Number(heading.tagName.slice(1));
        while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
        this.sectionAncestors.set(heading, stack.map((item) => item.heading.id));
        const title = heading.textContent.trim();
        heading.dataset.sectionTitle = title;
        heading.setAttribute("aria-label", title);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "section-toggle";
        toggle.setAttribute("aria-label", `折叠章节：${title}`);
        toggle.setAttribute("aria-expanded", "true");
        toggle.title = "折叠此章节";
        toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
        toggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleSection(heading);
        });
        heading.prepend(toggle);
        headings.push(heading);
        stack.push({ level, heading });
      } else {
        this.sectionAncestors.set(element, stack.map((item) => item.heading.id));
      }
    }

    this.foldHeadings = headings;
    const availableIds = new Set(headings.map((heading) => heading.id));
    for (const id of collapsed) {
      if (!availableIds.has(id)) collapsed.delete(id);
    }
    this.applySectionFolding();
  }

  private revealSectionFor(target: Element): void {
    let topLevel: Element | null = target;
    while (topLevel?.parentElement && topLevel.parentElement !== this.content) {
      topLevel = topLevel.parentElement;
    }
    if (!(topLevel instanceof HTMLElement)) return;
    const owners = this.sectionAncestors.get(topLevel) ?? [];
    const collapsed = this.currentSectionState();
    let changed = false;
    for (const id of owners) changed = collapsed.delete(id) || changed;
    if (changed) this.applySectionFolding();
  }

  private listItemSummary(item: HTMLLIElement): string {
    const parts: string[] = [];
    for (const node of item.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? "");
        continue;
      }
      if (!(node instanceof Element)) continue;
      if (node.matches("ul,ol,blockquote,pre,table,figure,.code-block,.diagram-shell")) break;
      parts.push(node.textContent ?? "");
      if (node.matches("p")) break;
    }
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 100) || "未命名列表项";
  }

  private listItemSummaryParagraph(item: HTMLLIElement): HTMLParagraphElement | null {
    const firstBlock = [...item.children].find((child) => child.matches(foldableSelector));
    return firstBlock instanceof HTMLParagraphElement ? firstBlock : null;
  }

  private foldableListChildren(item: HTMLLIElement): HTMLElement[] {
    const firstParagraph = this.listItemSummaryParagraph(item);
    return [...item.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement
        && child !== firstParagraph
        && child.matches(foldableSelector),
    );
  }

  private applyListFolding(): void {
    const collapsed = this.currentListState();
    for (const entry of this.foldListItems) {
      const folded = collapsed.has(entry.id);
      entry.item.classList.toggle("list-item-collapsed", folded);
      entry.toggle.setAttribute("aria-expanded", String(!folded));
      const action = folded ? "展开" : "折叠";
      entry.toggle.title = `${action}此列表项`;
      entry.toggle.setAttribute("aria-label", `${action}列表项：${entry.title}`);
      entry.content.forEach((element) => element.classList.toggle("list-content-hidden", folded));
    }
    requestAnimationFrame(this.updateProgress);
  }

  private toggleListItem(entry: FoldListEntry): void {
    const collapsed = this.currentListState();
    if (collapsed.has(entry.id)) collapsed.delete(entry.id);
    else collapsed.add(entry.id);
    this.applyListFolding();
  }

  private setupLists(): void {
    const collapsed = this.currentListState();
    const occurrences = new Map<string, number>();
    const entries: FoldListEntry[] = [];

    for (const item of this.content.querySelectorAll<HTMLLIElement>("li")) {
      const content = this.foldableListChildren(item);
      if (!content.length) continue;
      const title = this.listItemSummary(item);
      const occurrence = occurrences.get(title) ?? 0;
      occurrences.set(title, occurrence + 1);
      const id = `${title}::${occurrence}`;
      const toggle = document.createElement("button");
      const entry: FoldListEntry = { item, toggle, content, id, title };
      toggle.type = "button";
      toggle.className = "list-toggle";
      toggle.setAttribute("aria-label", `折叠列表项：${title}`);
      toggle.setAttribute("aria-expanded", "true");
      toggle.title = "折叠此列表项";
      toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleListItem(entry);
      });
      (this.listItemSummaryParagraph(item) ?? item).prepend(toggle);
      item.classList.add("foldable-list-item");
      content.forEach((element) => element.classList.add("list-fold-content"));
      entries.push(entry);
    }

    this.foldListItems = entries;
    const availableIds = new Set(entries.map((entry) => entry.id));
    for (const id of collapsed) {
      if (!availableIds.has(id)) collapsed.delete(id);
    }
    this.applyListFolding();
  }

  private revealListFor(target: Element): void {
    const collapsed = this.currentListState();
    let item = target.closest<HTMLLIElement>("li.foldable-list-item");
    let changed = false;
    while (item) {
      const entry = this.foldListItems.find((candidate) => candidate.item === item);
      if (entry) changed = collapsed.delete(entry.id) || changed;
      item = item.parentElement?.closest<HTMLLIElement>("li.foldable-list-item") ?? null;
    }
    if (changed) this.applyListFolding();
  }
}
