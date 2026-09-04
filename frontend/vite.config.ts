import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    manifest: "manifest.json",
    outDir: resolve(import.meta.dirname, "../markdown_reader/static/dist"),
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/main.ts"),
    },
  },
});
