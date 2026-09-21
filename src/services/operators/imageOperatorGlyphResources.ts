import type { GlyphAtlasOptions, GlyphAtlasPlan } from '../../effects/_shared/glyphAtlas';
import { planGlyphAtlas } from '../../effects/_shared/glyphAtlas';
import type { BoundOperatorNode } from '../../types/operatorGraph';
import type { ImageOperatorGlyphAtlasResource } from './imageOperatorExternalResources';
export type { ImageOperatorExternalResource, ImageOperatorGlyphAtlasResource } from './imageOperatorExternalResources';

export interface ImageOperatorGlyphAtlasBindings {
  rampPreset: string;
  customRamp: string;
  fontFamily: string;
  fontWeight: string;
}
export type ResolveImageOperatorGlyphAtlas = (
  bindings: ImageOperatorGlyphAtlasBindings,
  params: Record<string, unknown>,
) => GlyphAtlasOptions;

export function resolveImageOperatorGlyphAtlas(node: BoundOperatorNode, params: Record<string, unknown>,
  resolver: ResolveImageOperatorGlyphAtlas | undefined): { descriptor: ImageOperatorGlyphAtlasResource; plan: GlyphAtlasPlan } {
  const names = ['rampPreset', 'customRamp', 'fontFamily', 'fontWeight'] as const;
  const bindings = Object.fromEntries(names.map(name => [name, node.bindings[name]])) as Partial<ImageOperatorGlyphAtlasBindings>;
  if (names.some(name => typeof bindings[name] !== 'string' || !bindings[name])) {
    throw new Error(`Glyph atlas ${node.id} requires rampPreset, customRamp, fontFamily, and fontWeight owner bindings.`);
  }
  if (!resolver) throw new Error(`Glyph atlas ${node.id} requires a transient atlas resolver.`);
  const options = resolver(bindings as ImageOperatorGlyphAtlasBindings, params);
  if (!options || typeof options.fontFamily !== 'string' || !options.fontFamily || typeof options.charset !== 'string'
    || typeof options.cellSize !== 'number' || !Number.isFinite(options.cellSize)
    || (options.fontWeight !== undefined && (typeof options.fontWeight !== 'number' || !Number.isFinite(options.fontWeight)))) {
    throw new Error(`Glyph atlas ${node.id} resolver returned invalid options.`);
  }
  return { descriptor: { id: `glyph-atlas:${node.id}`, kind: 'glyph-atlas', options: { ...options } }, plan: planGlyphAtlas(options) };
}
