import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureDomVisibleCanvasProof } from '../../src/services/aiTools/visiblePixelProof';

const originalElementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
  ?? Object.getOwnPropertyDescriptor(document, 'hidden');
const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
  ?? Object.getOwnPropertyDescriptor(document, 'visibilityState');

function createCanvas(rect: Partial<DOMRect>, options: {
  connected?: boolean;
  elementFromPoint?: Element | null;
} = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  Object.defineProperty(canvas, 'isConnected', {
    configurable: true,
    value: options.connected ?? true,
  });
  canvas.getBoundingClientRect = vi.fn(() => ({
    x: rect.x ?? 10,
    y: rect.y ?? 20,
    left: rect.left ?? 10,
    top: rect.top ?? 20,
    right: rect.right ?? 330,
    bottom: rect.bottom ?? 200,
    width: rect.width ?? 320,
    height: rect.height ?? 180,
    toJSON: () => ({}),
  } as DOMRect));
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => options.elementFromPoint ?? canvas),
  });
  return canvas;
}

describe('visible pixel proof', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalElementFromPointDescriptor) {
      Object.defineProperty(document, 'elementFromPoint', originalElementFromPointDescriptor);
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    } else {
      Reflect.deleteProperty(document, 'hidden');
    }
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('reports DOM visibility metadata without requiring GPU readback', () => {
    const canvas = createCanvas({}, { connected: true });

    const proof = captureDomVisibleCanvasProof(canvas, { includeFingerprint: false });

    expect(proof.attached).toBe(true);
    expect(proof.document).toMatchObject({
      hidden: false,
      visibilityState: 'visible',
      visible: true,
    });
    expect(proof.cssSize).toEqual({ width: 320, height: 180 });
    expect(proof.backingSize).toEqual({ width: 320, height: 180 });
    expect(proof.viewportIntersecting).toBe(true);
    expect(proof.centerOccluded).toBe(false);
    expect(proof.fingerprint).toBeNull();
    expect(proof.errors).toEqual([]);
  });

  it('flags viewport and center occlusion problems', () => {
    const overlay = document.createElement('div');
    const canvas = createCanvas({
      left: -500,
      top: -500,
      right: -100,
      bottom: -100,
      width: 320,
      height: 180,
    }, {
      connected: false,
      elementFromPoint: overlay,
    });

    const proof = captureDomVisibleCanvasProof(canvas, { includeFingerprint: false });

    expect(proof.attached).toBe(false);
    expect(proof.viewportIntersecting).toBe(false);
    expect(proof.centerOccluded).toBe(true);
  });

  it('flags hidden documents as invalid visible proof environments', () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const canvas = createCanvas({}, { connected: true });

    const proof = captureDomVisibleCanvasProof(canvas, { includeFingerprint: false });

    expect(proof.document).toMatchObject({
      hidden: true,
      visibilityState: 'hidden',
      visible: false,
    });
    expect(proof.errors).toContain('Document is hidden; visible-presentation proof requires a foreground tab.');
  });
});
