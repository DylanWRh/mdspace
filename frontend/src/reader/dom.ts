export interface ReaderElements {
  fileTree: HTMLElement;
  fileSearch: HTMLInputElement;
  fileCount: HTMLElement;
  content: HTMLElement;
  status: HTMLElement;
  footer: HTMLElement;
  toc: HTMLElement;
  breadcrumbs: HTMLElement;
  preview: HTMLElement;
  previewPath: HTMLElement;
  previewContent: HTMLElement;
  readingMeta: HTMLElement;
  progress: HTMLElement;
  lightbox: HTMLElement;
  toast: HTMLElement;
  workspaceName: HTMLElement;
  workspaceBackdrop: HTMLElement;
  workspaceForm: HTMLFormElement;
  workspacePath: HTMLInputElement;
  workspaceList: HTMLElement;
  workspaceError: HTMLElement;
  switchWorkspace: HTMLButtonElement;
  welcome: HTMLElement;
  directoryBrowser: HTMLElement;
  directoryLocation: HTMLElement;
  directoryList: HTMLElement;
  directoryUp: HTMLButtonElement;
  directoryStatus: HTMLElement;
  chooseCurrentDirectory: HTMLButtonElement;
  readMode: HTMLButtonElement;
  editMode: HTMLButtonElement;
  finishEdit: HTMLButtonElement;
  saveDocument: HTMLButtonElement;
  editor: HTMLElement;
  editorPath: HTMLElement;
  toggleAllSections: HTMLButtonElement;
  refreshDocument: HTMLButtonElement;
  toggleLeft: HTMLButtonElement;
  toggleRight: HTMLButtonElement;
  openLeft: HTMLButtonElement;
  closeLeft: HTMLButtonElement;
  mobileScrim: HTMLElement;
  backToTop: HTMLButtonElement;
  openWorkspaceSwitcher: HTMLButtonElement;
  welcomeChooseWorkspace: HTMLButtonElement;
  closeWorkspaceSwitcher: HTMLButtonElement;
  browseWorkspace: HTMLButtonElement;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required reader element not found: ${selector}`);
  return element;
}

export function readerElements(): ReaderElements {
  return {
    fileTree: requiredElement("#fileTree"),
    fileSearch: requiredElement("#fileSearch"),
    fileCount: requiredElement("#fileCount"),
    content: requiredElement("#documentContent"),
    status: requiredElement("#documentStatus"),
    footer: requiredElement("#documentFooter"),
    toc: requiredElement("#tableOfContents"),
    breadcrumbs: requiredElement("#breadcrumbs"),
    preview: requiredElement("#linkPreview"),
    previewPath: requiredElement("#previewPath"),
    previewContent: requiredElement("#previewContent"),
    readingMeta: requiredElement("#readingMeta"),
    progress: requiredElement("#readingProgress"),
    lightbox: requiredElement("#lightbox"),
    toast: requiredElement("#toast"),
    workspaceName: requiredElement("#workspaceName"),
    workspaceBackdrop: requiredElement("#workspaceBackdrop"),
    workspaceForm: requiredElement("#workspaceForm"),
    workspacePath: requiredElement("#workspacePath"),
    workspaceList: requiredElement("#workspaceList"),
    workspaceError: requiredElement("#workspaceError"),
    switchWorkspace: requiredElement("#switchWorkspace"),
    welcome: requiredElement("#workspaceWelcome"),
    directoryBrowser: requiredElement("#directoryBrowser"),
    directoryLocation: requiredElement("#directoryLocation"),
    directoryList: requiredElement("#directoryList"),
    directoryUp: requiredElement("#directoryUp"),
    directoryStatus: requiredElement("#directoryStatus"),
    chooseCurrentDirectory: requiredElement("#chooseCurrentDirectory"),
    readMode: requiredElement("#readMode"),
    editMode: requiredElement("#editMode"),
    finishEdit: requiredElement("#finishEdit"),
    saveDocument: requiredElement("#saveDocument"),
    editor: requiredElement("#editorShell"),
    editorPath: requiredElement("#editorPath"),
    toggleAllSections: requiredElement("#toggleAllSections"),
    refreshDocument: requiredElement("#refreshDocument"),
    toggleLeft: requiredElement("#toggleLeft"),
    toggleRight: requiredElement("#toggleRight"),
    openLeft: requiredElement("#openLeft"),
    closeLeft: requiredElement("#closeLeft"),
    mobileScrim: requiredElement("#mobileScrim"),
    backToTop: requiredElement("#backToTop"),
    openWorkspaceSwitcher: requiredElement("#openWorkspaceSwitcher"),
    welcomeChooseWorkspace: requiredElement("#welcomeChooseWorkspace"),
    closeWorkspaceSwitcher: requiredElement("#closeWorkspaceSwitcher"),
    browseWorkspace: requiredElement("#browseWorkspace"),
  };
}
