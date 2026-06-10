export interface Point2D {
  x: number;
  y: number;
}

export interface GlyphData {
  ha: number;
  o?: string;
  _cachedOutline?: string[];
}

export interface FontData {
  glyphs: Record<string, GlyphData>;
  resolution: number;
  familyName: string;
}

export interface TextShape {
  contour: Point2D[];
  holes: Point2D[][];
}

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LoopLayer {
  points: Point2D[];
  z: number;
  normalZ: number;
}

export interface TextMeshGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  edgeIndices: Uint32Array;
}

export type TextMeshFontFamily = 'helvetiker' | 'optimer' | 'gentilis';
export type TextMeshFontWeight = 'regular' | 'bold';
export type TextMeshTextAlign = 'left' | 'center' | 'right';

export interface TextMeshBuildProps {
  text: string;
  fontFamily: TextMeshFontFamily;
  fontWeight: TextMeshFontWeight;
  size: number;
  depth: number;
  letterSpacing: number;
  lineHeight: number;
  textAlign: TextMeshTextAlign;
  curveSegments: number;
  bevelEnabled: boolean;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
}
