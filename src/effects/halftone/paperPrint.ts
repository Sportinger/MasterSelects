// Paper Print: its presets and card notes. The recipe is the editable graph in
// src/services/operators/paperPrintGrainGraph.ts (createDefaultPaperPrintGraph) and its shader twin paperPrintFragment;
// Grain Size counts pixels of a 1080p frame.
import type { EffectPreset } from '../types';
import { colorToRgba } from '../_shared/catalogColor';
import { PAPER_PRINT_SPAN_FLOOR } from '../../services/operators/paperPrintGrainGraph';

/** Default Ink and Paper: warm black on cream. Effects saved without them had the shared #111827 and #f8fafc. */
export const PAPER_PRINT_INK = '#1c1a18';
export const PAPER_PRINT_PAPER = '#f3ecdc';

export const PAPER_PRINT_PRESETS: readonly EffectPreset[] = [
  // Brown-black on warm paper, a fine grain: an old photogravure in a book, almost as smooth as a photo.
  { id: 'photogravure', name: 'Photogravure', params: { scale: 2.5, texture: 0.5, amount: 1, colorA: '#3a2416', colorB: '#eee0c4' } },
  // Warm black on cream, a clearly visible grain: the velvety grain of a mezzotint.
  { id: 'mezzotint', name: 'Mezzotint', params: { scale: 4, texture: 0.35, amount: 1, colorA: '#1f1a17', colorB: '#f1e8d4' } },
  // White ink on deep blue paper: the light parts of the picture are printed.
  { id: 'blueprint', name: 'Blueprint', params: { scale: 4, texture: 0.6, amount: 1, colorA: '#eef2f6', colorB: '#1d4c8c' } },
  // Signal red on off-white, a big grain: a screen-printed poster.
  { id: 'red-poster', name: 'Red Poster', params: { scale: 10, texture: 0.3, amount: 1, colorA: '#c8202e', colorB: '#f5efe4' } },
];

const linearLight = (color: number | boolean | string | undefined, fallback: string) => {
  const [r, g, b] = colorToRgba(color, fallback).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Card notes: a graph-less Paper Print saved before Texture (no `texture`, hasEarlierPaperPrintParams) renders its
 * earlier recipe; Ink and Paper of (almost) the same brightness cannot carry the picture's tones.
 */
export function paperPrintNotes(params: Record<string, number | boolean | string>): string[] {
  if (params.texture === undefined) {
    return ['This Paper Print was saved before Texture and keeps its earlier look (a soft two-colour print under a blocky grain); add Paper Print again to use Texture and the presets as designed.'];
  }
  const span = Math.abs(linearLight(params.colorB, PAPER_PRINT_PAPER) - linearLight(params.colorA, PAPER_PRINT_INK));
  if (span < PAPER_PRINT_SPAN_FLOOR) return ['Ink and Paper are equally bright, so the print cannot show the picture\'s tones. Make one of them darker.'];
  if (span < 0.05) return ['Ink and Paper are almost equally bright, so the picture shows only faintly. Make one of them darker.'];
  return [];
}
