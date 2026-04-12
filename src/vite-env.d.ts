/// <reference types="vite/client" />

declare module '/gaussian-splat/gaussian-splat-renderer-for-lam.module.js' {
  export const DropInViewer: new (options?: Record<string, unknown>) => import('three').Group & {
    addSplatScene: (path: string, options?: Record<string, unknown>) => Promise<unknown>;
    getSceneCount?: () => number;
    getSplatScene?: (index: number) => { opacity?: number; visible?: boolean } | undefined;
    splatMesh?: {
      setSplatScale?: (scale: number) => void;
    };
    dispose?: () => Promise<void> | void;
  };
}

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
