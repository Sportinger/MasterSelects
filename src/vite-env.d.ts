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
