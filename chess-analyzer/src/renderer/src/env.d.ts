/// <reference types="vite/client" />
/// <reference types="../../preload/index.d.ts" />

declare module '*.tsv?raw' {
  const content: string;
  export default content;
}
