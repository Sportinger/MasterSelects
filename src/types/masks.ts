// Mask types for After Effects-style clip masking
export type MaskVertexHandleMode = 'none' | 'mirrored' | 'split';

export interface MaskVertex {
  id: string;
  x: number;              // Position relative to clip (0-1 normalized)
  y: number;
  handleIn: { x: number; y: number };   // Bezier control handle (relative to vertex)
  handleOut: { x: number; y: number };  // Bezier control handle (relative to vertex)
  handleMode?: MaskVertexHandleMode;     // Corner, linked bezier handles, or split handles
}

export type MaskMode = 'add' | 'subtract' | 'intersect';

export interface ClipMask {
  id: string;
  name: string;
  vertices: MaskVertex[];
  closed: boolean;        // Is the path closed
  opacity: number;        // 0-1
  feather: number;        // Blur amount in pixels
  edgeFeathers?: Record<string, number>; // Per-edge blur amount in pixels, keyed by ordered vertex pair
  featherQuality: number; // 0=low (fast), 1=medium, 2=high (smooth)
  inverted: boolean;
  mode: MaskMode;
  expanded: boolean;      // UI state - expanded in properties panel
  position: { x: number; y: number };  // Offset in normalized coords (0-1)
  enabled: boolean;       // Whether the mask affects rendering
  visible: boolean;       // Toggle outline visibility
  outlineColor?: string;  // Preview overlay stroke color
}

export interface TextBoundsPath {
  id: string;
  vertices: MaskVertex[];
  closed: boolean;
  position: { x: number; y: number };  // Offset in normalized text-canvas coords
  visible?: boolean;
  outlineColor?: string;
}

export interface MaskPathKeyframeValue {
  vertices: MaskVertex[];
  closed: boolean;
}
