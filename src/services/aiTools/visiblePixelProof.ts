import {
  fingerprintCanvas,
  type FrameFingerprint,
  type FrameFingerprintOptions,
} from './frameFingerprint';

export interface DomVisibleCanvasProofOptions extends FrameFingerprintOptions {
  readonly includeFingerprint?: boolean;
}

export interface DomVisibleCanvasProof {
  readonly document: DomVisibleDocumentState;
  readonly attached: boolean;
  readonly cssSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly backingSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly viewportIntersecting: boolean;
  readonly centerOccluded: boolean | null;
  readonly fingerprint: FrameFingerprint | null;
  readonly errors: readonly string[];
}

export interface DomVisibleDocumentState {
  readonly visibilityState: string | null;
  readonly hidden: boolean | null;
  readonly hasFocus: boolean | null;
  readonly visible: boolean;
}

export function getDomVisibleDocumentState(): DomVisibleDocumentState {
  if (typeof document === 'undefined') {
    return {
      visibilityState: null,
      hidden: null,
      hasFocus: null,
      visible: true,
    };
  }

  const visibilityState = typeof document.visibilityState === 'string'
    ? document.visibilityState
    : null;
  const hidden = typeof document.hidden === 'boolean'
    ? document.hidden
    : null;
  const hasFocus = typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : null;

  return {
    visibilityState,
    hidden,
    hasFocus,
    visible: hidden !== true && visibilityState !== 'hidden',
  };
}

function intersectsViewport(rect: DOMRect, viewportWidth: number, viewportHeight: number): boolean {
  return rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < viewportWidth
    && rect.top < viewportHeight;
}

function getCenterOcclusion(canvas: HTMLCanvasElement, rect: DOMRect): boolean | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return null;
  }
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : rect.right;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : rect.bottom;
  const x = Math.max(0, Math.min((viewportWidth || rect.right) - 1, rect.left + rect.width / 2));
  const y = Math.max(0, Math.min((viewportHeight || rect.bottom) - 1, rect.top + rect.height / 2));
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  return element !== canvas && !canvas.contains(element);
}

export function captureDomVisibleCanvasProof(
  canvas: HTMLCanvasElement,
  options: DomVisibleCanvasProofOptions = {},
): DomVisibleCanvasProof {
  const rect = canvas.getBoundingClientRect();
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : rect.right;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : rect.bottom;
  const errors: string[] = [];
  let fingerprint: FrameFingerprint | null = null;
  const documentState = getDomVisibleDocumentState();

  if (!documentState.visible) {
    errors.push('Document is hidden; visible-presentation proof requires a foreground tab.');
  }

  if (options.includeFingerprint ?? true) {
    try {
      fingerprint = fingerprintCanvas(canvas, options);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    document: documentState,
    attached: canvas.isConnected,
    cssSize: {
      width: rect.width,
      height: rect.height,
    },
    backingSize: {
      width: canvas.width,
      height: canvas.height,
    },
    viewportIntersecting: intersectsViewport(rect, viewportWidth, viewportHeight),
    centerOccluded: getCenterOcclusion(canvas, rect),
    fingerprint,
    errors,
  };
}
