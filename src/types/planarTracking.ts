/** Source-normalized, source-time tracking data. Never contains runtime handles. */
export interface SurfacePoint { x: number; y: number }
export type SurfaceQuad = [SurfacePoint, SurfacePoint, SurfacePoint, SurfacePoint];
export interface SurfaceSample {
  time: number;
  /** Actual decoded presentation duration; absent on legacy nominal-FPS tracks. */
  duration?: number;
  quad: SurfaceQuad;
  confidence: number;
  manual?: boolean;
}
export interface SurfaceOcclusion { time: number; quad: SurfaceQuad | null }
export interface PlanarTrack {
  id: string;
  name: string;
  sourceId: string;
  fps: number;
  referenceTime: number;
  referenceQuad: SurfaceQuad;
  samples: SurfaceSample[];
  occlusions: SurfaceOcclusion[];
  enabled: boolean;
  color: string;
  opacity: number;
  fill: number;
  lineWidth: number;
  inset: number;
  shape: 'outline' | 'ellipse' | 'cross';
  visibleFrom: number;
  visibleTo: number;
  fade: number;
  projection?: 'planar' | 'mesh';
  terrain?: import('./terrainTracking').TerrainReconstruction;
  showMesh?: boolean;
  placement?: import('./terrainTracking').TerrainPlacement;
  footstepLookAhead?: number;
  /** Artistic decision visualization; confidence values are deliberately fictional. */
  footstepPresentation?: 'decision';
  /** Authored scenic beat; displayed drop distance is fictional, not measured. */
  footstepInterlude?: { start: number; end: number; dropMeters: number; dropGreaterThan?: boolean };
}
