export type EditorRepresentation = "rich" | "source";
export type SaveStatus = "clean" | "dirty" | "saving" | "conflict" | "error";

export interface EditingSnapshot {
  path: string;
  workspace: string;
  version: string;
  savedMarkdown: string;
  currentMarkdown: string;
  representation: EditorRepresentation;
  status: SaveStatus;
  error: string;
}

const EMPTY_SESSION: EditingSnapshot = {
  path: "",
  workspace: "",
  version: "",
  savedMarkdown: "",
  currentMarkdown: "",
  representation: "rich",
  status: "clean",
  error: "",
};

export class EditingSession {
  private value: EditingSnapshot = { ...EMPTY_SESSION };

  get snapshot(): Readonly<EditingSnapshot> {
    return this.value;
  }

  start(input: Pick<EditingSnapshot, "path" | "workspace" | "version"> & { source: string }): void {
    this.value = {
      path: input.path,
      workspace: input.workspace,
      version: input.version,
      savedMarkdown: input.source,
      currentMarkdown: input.source,
      representation: "rich",
      status: "clean",
      error: "",
    };
  }

  update(markdown: string): void {
    this.value = {
      ...this.value,
      currentMarkdown: markdown,
      status: markdown === this.value.savedMarkdown ? "clean" : "dirty",
      error: "",
    };
  }

  switchRepresentation(representation: EditorRepresentation): void {
    this.value = { ...this.value, representation };
  }

  beginSave(): void {
    if (this.value.status !== "dirty" && this.value.status !== "error") return;
    this.value = { ...this.value, status: "saving", error: "" };
  }

  saved(source: string, version: string): void {
    const currentMarkdown = this.value.currentMarkdown;
    this.value = {
      ...this.value,
      savedMarkdown: source,
      currentMarkdown,
      version,
      status: currentMarkdown === source ? "clean" : "dirty",
      error: "",
    };
  }

  failed(message: string, conflict = false): void {
    this.value = {
      ...this.value,
      status: conflict ? "conflict" : "error",
      error: message,
    };
  }

  reset(): void {
    this.value = { ...EMPTY_SESSION };
  }
}
