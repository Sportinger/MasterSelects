import type { GlyphAtlasOptions } from '../../effects/_shared/glyphAtlas';
export interface ImageOperatorGlyphAtlasResource { id: string; kind: 'glyph-atlas'; options: GlyphAtlasOptions }
export interface ImageOperatorMemoryWindowOptions {
  size: number; depth: '8' | '16' | '32'; offset: number; motion: 'static' | 'advance' | 'shuffle'; stride: number; seed: number; snapshot: string;
}
export interface ImageOperatorMemoryWindowResource { id: string; kind: 'memory-window'; options: ImageOperatorMemoryWindowOptions }
export type ImageOperatorExternalResource = ImageOperatorGlyphAtlasResource | ImageOperatorMemoryWindowResource;
