import "@milkdown/crepe/theme/common/style.css";
import "./styles/app.css";
import "./styles/editor.css";

import { createEditorBridge, type EditorBridge } from "./editor/bridge";

declare global {
  interface Window {
    markdownReaderEditor: EditorBridge;
  }
}

window.markdownReaderEditor = createEditorBridge();
await import("./reader/app");
