// Gaussian Splat Scene Renderer — singleton wrapper around the Gaussian Splat renderer module.
// Manages lifecycle, blendshape expression data, and canvas access for compositor integration.

import { Logger } from '../../services/logger';

const log = Logger.create('GaussianSplatSceneRenderer');

interface GaussianSplatRendererInstance {
  dispose?: () => void;
}

interface GaussianSplatRendererModule {
  GaussianSplatRenderer: {
    _canvas?: HTMLCanvasElement;
    instance?: unknown;
    getInstance: (
      container: HTMLDivElement | null,
      url: string,
      options: {
        getChatState: () => string;
        getExpressionData: () => Record<string, number>;
        backgroundColor: string;
        alpha: number;
        useBuiltInControls: boolean;
      },
    ) => Promise<GaussianSplatRendererInstance | null | undefined>;
  };
}

type WindowWithNProgress = Window & typeof globalThis & {
  NProgress?: {
    start: () => void;
    done: () => void;
    set: (value: number) => void;
  };
};

export class GaussianSplatSceneRenderer {
  private module: GaussianSplatRendererModule | null = null;
  private renderer: GaussianSplatRendererInstance | null = null;
  private container: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private currentAvatarUrl: string | null = null;
  private _initialized = false;
  private _avatarLoaded = false;
  private loading = false;
  private blendshapes: Record<string, number> = {};

  get isInitialized(): boolean {
    return this._initialized;
  }

  get isAvatarLoaded(): boolean {
    return this._avatarLoaded;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  async initialize(): Promise<boolean> {
    if (this._initialized) return true;

    try {
      // Shim NProgress on window (renderer expects it)
      const progressWindow = window as WindowWithNProgress;
      if (!progressWindow.NProgress) {
        progressWindow.NProgress = { start: () => {}, done: () => {}, set: () => {} };
      }

      // Load the 5MB module from public/ via fetch → blob URL → import()
      // (Vite blocks direct import() of public/ files in dev mode)
      log.info('Loading Gaussian Splat renderer module...');
      const response = await fetch('/gaussian-splat/gaussian-splat-renderer-for-lam.module.js');
      const text = await response.text();
      const blob = new Blob([text], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      this.module = await import(/* @vite-ignore */ blobUrl) as GaussianSplatRendererModule;
      URL.revokeObjectURL(blobUrl);
      log.info('Gaussian Splat renderer module loaded');

      // Create hidden container div for off-screen rendering
      this.container = document.createElement('div');
      this.container.style.position = 'fixed';
      this.container.style.left = '-9999px';
      this.container.style.top = '0';
      this.container.style.width = '1920px';
      this.container.style.height = '1080px';
      document.body.appendChild(this.container);

      this._initialized = true;
      log.info('GaussianSplatSceneRenderer initialized');
      return true;
    } catch (err) {
      log.error('Failed to initialize GaussianSplatSceneRenderer', err);
      return false;
    }
  }

  async loadAvatar(zipUrl: string): Promise<boolean> {
    if (!this._initialized || !this.module) {
      log.error('Cannot load avatar: renderer not initialized');
      return false;
    }

    // If same URL already loaded, skip
    if (this._avatarLoaded && this.currentAvatarUrl === zipUrl) {
      return true;
    }

    // Prevent concurrent loads
    if (this.loading) {
      log.debug('Avatar load already in progress, skipping');
      return false;
    }

    // If different URL, dispose current renderer first
    if (this.renderer) {
      log.info('Disposing previous renderer before loading new avatar');
      try {
        if (typeof this.renderer.dispose === 'function') {
          this.renderer.dispose();
        }
      } catch (err) {
        log.warn('Error disposing previous renderer', err);
      }
      this.renderer = null;
      this.canvas = null;
      this._avatarLoaded = false;
    }

    this.loading = true;

    try {
      // The renderer module's internal axios can't fetch blob: URLs.
      // If the URL is a blob URL, upload the data to the dev server's blob store
      // and use the resulting HTTP URL instead.
      let resolvedUrl = zipUrl;
      if (zipUrl.startsWith('blob:')) {
        log.info('Converting blob URL to HTTP URL via blob store...');
        try {
          const blobResp = await fetch(zipUrl);
          const blobData = await blobResp.arrayBuffer();
          const storeResp = await fetch('/api/blob-store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/zip' },
            body: blobData,
          });
          if (storeResp.ok) {
            const { url } = await storeResp.json();
            resolvedUrl = url;
            log.info('Blob URL proxied to HTTP', { resolvedUrl });
          } else {
            log.warn('Blob store upload failed, trying blob URL directly', { status: storeResp.status });
          }
        } catch (proxyErr) {
          log.warn('Blob URL proxy failed, trying blob URL directly', proxyErr);
        }
      }

      log.info('Loading avatar', { url: resolvedUrl });

      this.renderer = (await this.module.GaussianSplatRenderer.getInstance(
        this.container,
        resolvedUrl,
        {
          getChatState: () => 'idle',
          getExpressionData: () => this.blendshapes,
          backgroundColor: '0x000000',
          alpha: 0, // transparent background for compositing
          useBuiltInControls: false, // no orbit controls in editor
        },
      )) ?? null;

      // Validate the renderer was actually created
      if (!this.renderer) {
        log.error('GaussianSplatRenderer.getInstance returned null/undefined', { url: zipUrl });
        this.loading = false;
        return false;
      }

      // Store canvas ref — try static property first, then query container
      this.canvas =
        this.module.GaussianSplatRenderer._canvas ||
        this.container?.querySelector('canvas') ||
        null;

      // Validate canvas has a rendering context (WebGL)
      if (this.canvas) {
        const gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        if (!gl) {
          log.error('Gaussian Splat canvas has no WebGL context — avatar load failed');
          this.renderer = null;
          this.canvas = null;
          this.loading = false;
          return false;
        }

        this.canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          log.warn('WebGL context lost on Gaussian Splat canvas');
        });
        this.canvas.addEventListener('webglcontextrestored', () => {
          log.info('WebGL context restored on Gaussian Splat canvas');
        });
      } else {
        log.error('No canvas found in container after avatar load');
        this.renderer = null;
        this.loading = false;
        return false;
      }

      this._avatarLoaded = true;
      this.currentAvatarUrl = zipUrl;
      this.loading = false;
      log.info('Avatar loaded successfully');
      return true;
    } catch (err) {
      log.error('Failed to load avatar', err);
      this.loading = false;
      return false;
    }
  }

  setBlendshapes(values: Record<string, number>): void {
    this.blendshapes = { ...values };
    // The renderer reads blendshapes via getExpressionData callback each frame
  }

  setBlendshape(name: string, value: number): void {
    this.blendshapes[name] = value;
  }

  getCanvas(): HTMLCanvasElement | null {
    if (!this._avatarLoaded || !this.renderer) return null;
    // Try to get canvas from container if not stored yet
    if (!this.canvas && this.container) {
      this.canvas = this.container.querySelector('canvas');
    }
    return this.canvas;
  }

  resize(width: number, height: number): void {
    if (this.container) {
      this.container.style.width = `${width}px`;
      this.container.style.height = `${height}px`;
    }
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  dispose(): void {
    // If renderer exists, try to call dispose on it
    if (this.renderer) {
      try {
        if (typeof this.renderer.dispose === 'function') {
          this.renderer.dispose();
        }
      } catch (err) {
        log.warn('Error disposing renderer', err);
      }
    }

    // Try to clear the static singleton
    if (this.module?.GaussianSplatRenderer) {
      try {
        delete this.module.GaussianSplatRenderer.instance;
      } catch {
        // ignore
      }
    }

    this._initialized = false;
    this._avatarLoaded = false;
    this.renderer = null;
    this.canvas = null;
    this.currentAvatarUrl = null;
    this.module = null;

    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;

    log.info('GaussianSplatSceneRenderer disposed');
  }
}

// HMR-safe singleton
let instance: GaussianSplatSceneRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.gaussianSplatRenderer) {
    instance = import.meta.hot.data.gaussianSplatRenderer;
  }
  import.meta.hot.dispose((data) => {
    data.gaussianSplatRenderer = instance;
  });
}

/** Get singleton GaussianSplatSceneRenderer (lazy — does not load module until initialize() is called) */
export function getGaussianSplatSceneRenderer(): GaussianSplatSceneRenderer {
  if (!instance) {
    instance = new GaussianSplatSceneRenderer();
  }
  return instance;
}
