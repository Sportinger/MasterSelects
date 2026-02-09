// Zustand store for SAM 2 AI segmentation state

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SAM2Point, SAM2FrameMask, ModelStatus, RLEMask } from '../services/sam2/types';

interface SAM2State {
  // Model state
  modelStatus: ModelStatus;
  downloadProgress: number; // 0-100
  errorMessage: string | null;

  // Session state
  isActive: boolean; // SAM2 mode enabled on preview
  isProcessing: boolean; // encoder/decoder running
  currentClipId: string | null;

  // Prompts (user-placed points)
  points: SAM2Point[];

  // Mask results: frameIndex → compressed mask
  frameMasks: Map<number, RLEMask>;

  // Current live mask (uncompressed, for preview overlay)
  liveMask: SAM2FrameMask | null;

  // Propagation
  propagationRange: { start: number; end: number } | null;
  propagationProgress: number; // 0-100
  isPropagating: boolean;

  // Mask display settings
  maskOpacity: number; // 0-1
  feather: number; // px
  inverted: boolean;
}

interface SAM2Actions {
  // Model actions
  setModelStatus: (status: ModelStatus) => void;
  setDownloadProgress: (progress: number) => void;
  setErrorMessage: (msg: string | null) => void;

  // Session actions
  setActive: (active: boolean) => void;
  setProcessing: (processing: boolean) => void;
  setCurrentClipId: (clipId: string | null) => void;

  // Point actions
  addPoint: (point: SAM2Point) => void;
  removePoint: (index: number) => void;
  clearPoints: () => void;

  // Mask actions
  setLiveMask: (mask: SAM2FrameMask | null) => void;
  setFrameMask: (frameIndex: number, mask: RLEMask) => void;
  clearFrameMasks: () => void;
  getFrameMask: (frameIndex: number) => RLEMask | undefined;

  // Propagation actions
  setPropagationRange: (range: { start: number; end: number } | null) => void;
  setPropagationProgress: (progress: number) => void;
  setIsPropagating: (propagating: boolean) => void;

  // Display settings
  setMaskOpacity: (opacity: number) => void;
  setFeather: (feather: number) => void;
  setInverted: (inverted: boolean) => void;

  // Reset
  reset: () => void;
}

const initialState: SAM2State = {
  modelStatus: 'not-downloaded',
  downloadProgress: 0,
  errorMessage: null,
  isActive: false,
  isProcessing: false,
  currentClipId: null,
  points: [],
  frameMasks: new Map(),
  liveMask: null,
  propagationRange: null,
  propagationProgress: 0,
  isPropagating: false,
  maskOpacity: 0.5,
  feather: 0,
  inverted: false,
};

export const useSAM2Store = create<SAM2State & SAM2Actions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Model actions
    setModelStatus: (status) => set({ modelStatus: status, errorMessage: status === 'error' ? get().errorMessage : null }),
    setDownloadProgress: (progress) => set({ downloadProgress: progress }),
    setErrorMessage: (msg) => set({ errorMessage: msg }),

    // Session actions
    setActive: (active) => set({ isActive: active }),
    setProcessing: (processing) => set({ isProcessing: processing }),
    setCurrentClipId: (clipId) => set({ currentClipId: clipId }),

    // Point actions
    addPoint: (point) => set((state) => ({ points: [...state.points, point] })),
    removePoint: (index) => set((state) => ({
      points: state.points.filter((_, i) => i !== index),
    })),
    clearPoints: () => set({ points: [], liveMask: null }),

    // Mask actions
    setLiveMask: (mask) => set({ liveMask: mask }),
    setFrameMask: (frameIndex, mask) => {
      const newMasks = new Map(get().frameMasks);
      newMasks.set(frameIndex, mask);
      set({ frameMasks: newMasks });
    },
    clearFrameMasks: () => set({ frameMasks: new Map() }),
    getFrameMask: (frameIndex) => get().frameMasks.get(frameIndex),

    // Propagation actions
    setPropagationRange: (range) => set({ propagationRange: range }),
    setPropagationProgress: (progress) => set({ propagationProgress: progress }),
    setIsPropagating: (propagating) => set({ isPropagating: propagating }),

    // Display settings
    setMaskOpacity: (opacity) => set({ maskOpacity: opacity }),
    setFeather: (feather) => set({ feather: feather }),
    setInverted: (inverted) => set({ inverted: inverted }),

    // Reset
    reset: () => set({ ...initialState, frameMasks: new Map() }),
  }))
);

// --- RLE compression utilities ---

/** Compress a 1-channel mask (0/255 values) to RLE */
export function compressMaskToRLE(data: Uint8Array, width: number, height: number): RLEMask {
  const counts: number[] = [];
  let currentVal = data[0] > 127 ? 1 : 0;
  let runLength = 0;

  // First element always indicates what value starts (0 = background first)
  // If foreground starts first, push a zero-length background run
  if (currentVal === 1) {
    counts.push(0);
  }

  for (let i = 0; i < data.length; i++) {
    const val = data[i] > 127 ? 1 : 0;
    if (val === currentVal) {
      runLength++;
    } else {
      counts.push(runLength);
      runLength = 1;
      currentVal = val;
    }
  }
  counts.push(runLength);

  return { counts: new Uint32Array(counts), width, height };
}

/** Decompress RLE to 1-channel mask */
export function decompressRLEToMask(rle: RLEMask): Uint8Array {
  const data = new Uint8Array(rle.width * rle.height);
  let offset = 0;
  let isForeground = false; // starts with background

  for (let i = 0; i < rle.counts.length; i++) {
    const count = rle.counts[i];
    if (isForeground) {
      data.fill(255, offset, offset + count);
    }
    // background stays 0 (default)
    offset += count;
    isForeground = !isForeground;
  }

  return data;
}

/** Convert 1-channel mask to RGBA ImageData (white foreground, black background with alpha) */
export function maskToImageData(mask: Uint8Array, width: number, height: number, inverted: boolean = false): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const val = inverted ? (mask[i] > 127 ? 0 : 255) : mask[i];
    const offset = i * 4;
    rgba[offset] = val;     // R
    rgba[offset + 1] = val; // G
    rgba[offset + 2] = val; // B
    rgba[offset + 3] = 255; // A (always fully opaque — the mask value IS the alpha)
  }
  return new ImageData(rgba, width, height);
}
