import type { GlyphAtlasOptions, GlyphAtlasPlan } from '../../effects/_shared/glyphAtlasPlan';
import { planGlyphAtlas } from '../../effects/_shared/glyphAtlasPlan';
import { GLYPH_FONT_OPTIONS } from '../../effects/_shared/glyphFonts';
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

export const TEXT_ATLAS_DEFAULT_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const TEXT_ATLAS_MAX_CHARACTERS = 256;
const TEXT_ATLAS_CELL_SIZE = 64;

/** Graph-local atlas options for glyph.text-atlas; unlike glyph.atlas it needs no effect-owned bindings. */
export function textAtlasOptions(node: Pick<BoundOperatorNode, 'id' | 'constants'>): GlyphAtlasOptions {
  const constants = node.constants ?? {};
  const characters = constants.characters ?? TEXT_ATLAS_DEFAULT_CHARACTERS;
  const fontFamily = constants.fontFamily ?? GLYPH_FONT_OPTIONS[0].value;
  const fontWeight = constants.fontWeight ?? 600;
  if (typeof characters !== 'string' || Array.from(characters).length > TEXT_ATLAS_MAX_CHARACTERS) {
    throw new Error(`Text atlas ${node.id} accepts at most ${TEXT_ATLAS_MAX_CHARACTERS} characters.`);
  }
  if (typeof fontFamily !== 'string' || !GLYPH_FONT_OPTIONS.some(option => option.value === fontFamily)) {
    throw new Error(`Text atlas ${node.id} has an unavailable font.`);
  }
  if (typeof fontWeight !== 'number' || !Number.isFinite(fontWeight)) throw new Error(`Text atlas ${node.id} has an invalid weight.`);
  // An empty atlas still renders one blank glyph so downstream index math stays defined.
  return { fontFamily, fontWeight: Math.min(900, Math.max(100, fontWeight)), charset: characters || ' ', cellSize: TEXT_ATLAS_CELL_SIZE };
}

export function resolveImageOperatorTextAtlas(node: Pick<BoundOperatorNode, 'id' | 'constants'>): { descriptor: ImageOperatorGlyphAtlasResource; plan: GlyphAtlasPlan } {
  const options = textAtlasOptions(node);
  return { descriptor: { id: `glyph-atlas:${node.id}`, kind: 'glyph-atlas', options }, plan: planGlyphAtlas(options) };
}
