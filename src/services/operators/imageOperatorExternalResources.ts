import type { GlyphAtlasOptions } from '../../effects/_shared/glyphAtlas';
export interface ImageOperatorGlyphAtlasResource { id: string; kind: 'glyph-atlas'; options: GlyphAtlasOptions }
export interface ImageOperatorMemoryWindowOptions {
  size: number; depth: '8' | '16' | '32'; offset: number; motion: 'static' | 'advance' | 'shuffle'; stride: number; seed: number; snapshot: string;
}
export interface ImageOperatorMemoryWindowResource { id: string; kind: 'memory-window'; options: ImageOperatorMemoryWindowOptions }
export interface ImageOperatorInputHistoryResource { id: string; kind: 'input-history'; part: 'atlas' | 'ages'; owner?: string }
export interface ImageOperatorSourceMotionResource { id: string; kind: 'source-motion'; part: 'atlas' | 'ages'; owner: string; lookback: number; timeFactor: number; stabilize?: boolean; required?: boolean; denseInverseSearch?: boolean }
/** Previous result of one Temporal Smooth node, owned by the effect's history scope. */
export interface ImageOperatorTemporalHistoryResource { id: string; kind: 'temporal-history'; owner: string }
export type ImageOperatorExternalResource = ImageOperatorGlyphAtlasResource | ImageOperatorMemoryWindowResource | ImageOperatorInputHistoryResource | ImageOperatorSourceMotionResource | ImageOperatorTemporalHistoryResource;
