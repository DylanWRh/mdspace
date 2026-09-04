/// <reference types="vite/client" />

declare module "*.css";

interface Window {
  mermaid?: {
    initialize(options: unknown): void;
    run(options: unknown): Promise<void>;
  };
  MathJax?: {
    typesetPromise(elements: Element[]): Promise<void>;
  };
}
