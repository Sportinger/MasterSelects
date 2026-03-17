/// <reference types="vite/client" />

// WGSL shader imports
declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}

declare module '*.wgsl' {
  const content: string;
  export default content;
}

declare const __DEV_BRIDGE_TOKEN__: string;
declare const __DEV_ALLOWED_FILE_ROOTS__: string[];
