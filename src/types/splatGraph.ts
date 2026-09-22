/** Serializable splat processing instructions. GPU resources belong to the renderer. */
export interface SplatGraphOperation {
  kind: 'limit' | 'scale' | 'rotate' | 'color' | 'select' | 'noise' | 'particles' | 'camera-fade' | 'sphere-crop';
  values: number[];
}

export interface SplatGraphBranch {
  id: string;
  operations: SplatGraphOperation[];
  applyClipTransform: boolean;
  budget?: number;
  mesh?: { resolution: number; threshold: number; radius: number; opacity: number; tint?: [number, number, number] };
}
