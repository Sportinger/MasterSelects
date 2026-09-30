import type { Layer } from '../../core/types';

interface Size {
  width: number;
  height: number;
}

interface FrameSignature {
  /** Borrowed identity only: the decoder owns and closes this frame. */
  frame: VideoFrame;
  visualKey: string;
  device: GPUDevice;
  context: GPUCanvasContext;
}

interface TargetPresentationState {
  canvas: HTMLCanvasElement;
  originalSize: Size;
  outputSize: Size | null;
  displaySize: Size;
  observer: ResizeObserver | null;
  presented: FrameSignature | null;
}

export interface MulticamPreviewPresentation extends Size {
  unchanged: boolean;
  signature: FrameSignature | null;
}

/** Camera monitors need display pixels, while the program keeps its own quality. */
export function resolveMulticamPreviewSize(
  reference: Size,
  display: Size,
  pixelRatio: number,
  maxTextureSize: number,
): Size {
  const width = Math.max(1, reference.width);
  const height = Math.max(1, reference.height);
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const scale = Math.min(
    1,
    1280 / width,
    720 / height,
    maxTextureSize / width,
    maxTextureSize / height,
    display.width > 0 ? display.width * ratio / width : 1,
    display.height > 0 ? display.height * ratio / height : 1,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function getStaticVideoSignature(
  layers: Layer[],
  reference: Size,
  output: Size,
  showGrid: boolean,
  device: GPUDevice,
  context: GPUCanvasContext,
): FrameSignature | null {
  if (layers.length !== 1) return null;
  const layer = layers[0];
  const source = layer.source;
  // Effects, masks, scenes and tracking can evolve without a new decoded frame.
  // Keep those paths rendering normally rather than guessing their dependencies.
  if (
    !layer.visible || layer.opacity === 0 || layer.blendMode !== 'normal'
    || layer.effects?.length || layer.colorCorrection || layer.temporalSource
    || layer.is3D || layer.sharedSceneGraph || layer.sceneGraph || layer.wireframe
    || layer.maskClipId || layer.masks?.length || layer.maskFeather || layer.maskInvert
    || layer.transitionRender || layer.terrainProjection || layer.terrainScreenAnchor
    || layer.trackingProjection || layer.trackingScreenAnchor || layer.terrainAnchorConnector
    || source?.type !== 'video' || source.videoElement || source.canvasElement
    || source.nestedComposition
  ) return null;
  const frame = source.videoFrame ?? source.webCodecsPlayer?.getCurrentFrame?.();
  if (!frame || !('displayWidth' in frame) || frame.displayWidth <= 0 || frame.displayHeight <= 0) return null;
  return {
    frame,
    device,
    context,
    visualKey: JSON.stringify([
      layer.id, layer.sourceClipId, layer.opacity, layer.position, layer.anchor,
      layer.scale, layer.rotation, layer.sourceRect, source.videoRotation,
      reference.width, reference.height, output.width, output.height, showGrid,
    ]),
  };
}

/** Owns pane sizing and presentation history, never decoder frames or sessions. */
export class MulticamPreviewPresentationState {
  private readonly targets = new Map<string, TargetPresentationState>();

  prepare(
    targetId: string,
    canvas: HTMLCanvasElement,
    reference: Size,
    layers: Layer[],
    showGrid: boolean,
    device: GPUDevice,
    context: GPUCanvasContext,
  ): MulticamPreviewPresentation {
    let state = this.targets.get(targetId);
    if (!state || state.canvas !== canvas) {
      this.release(targetId);
      const rect = canvas.getBoundingClientRect();
      state = {
        canvas,
        originalSize: { width: canvas.width, height: canvas.height },
        outputSize: null,
        displaySize: { width: rect.width, height: rect.height },
        observer: null,
        presented: null,
      };
      const observed = state;
      if (typeof ResizeObserver !== 'undefined') {
        state.observer = new ResizeObserver((entries) => {
          const entry = entries.find((candidate) => candidate.target === canvas);
          if (entry) observed.displaySize = { width: entry.contentRect.width, height: entry.contentRect.height };
        });
        state.observer.observe(canvas);
      }
      this.targets.set(targetId, state);
    } else if (!state.observer) {
      const rect = canvas.getBoundingClientRect();
      state.displaySize = { width: rect.width, height: rect.height };
    }

    // React or a caller may have supplied a new nominal resolution since the
    // previous camera frame. Remember it before taking ownership of the backing.
    if (state.outputSize && (
      canvas.width !== state.outputSize.width || canvas.height !== state.outputSize.height
    )) state.originalSize = { width: canvas.width, height: canvas.height };
    const size = resolveMulticamPreviewSize(
      reference,
      state.displaySize,
      canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
      device.limits.maxTextureDimension2D,
    );
    const resized = canvas.width !== size.width || canvas.height !== size.height;
    if (resized) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    state.outputSize = size;
    const signature = getStaticVideoSignature(layers, reference, size, showGrid, device, context);
    const previous = state.presented;
    const unchanged = !resized && signature !== null && previous !== null
      && signature.frame === previous.frame
      && signature.visualKey === previous.visualKey
      && signature.device === previous.device
      && signature.context === previous.context;
    // An intervening dynamic render invalidates the static presentation history.
    if (!signature) state.presented = null;
    return { ...size, signature, unchanged };
  }

  recordPresented(targetId: string, presentation: MulticamPreviewPresentation): void {
    const state = this.targets.get(targetId);
    if (state) state.presented = presentation.signature;
  }

  release(targetId: string, restoreCanvasSize = false): void {
    const state = this.targets.get(targetId);
    state?.observer?.disconnect();
    // A source switch can reuse the React canvas without changing its nominal
    // width/height props. Restore only our own backing size; a caller resize wins.
    if (state && restoreCanvasSize
      && state.canvas.width === state.outputSize?.width
      && state.canvas.height === state.outputSize?.height) {
      state.canvas.width = state.originalSize.width;
      state.canvas.height = state.originalSize.height;
    }
    this.targets.delete(targetId);
  }
}
