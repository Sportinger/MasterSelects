import { createGlyphEffect, type GlyphColorControl } from './glyphEffectFactory';
import { ASCII_PRESETS, GLYPH_MATRIX_PRESETS, RETRO_MATRIX_PRESETS, SYMBOL_MATRIX_PRESETS } from './glyphPresets';
import { RETRO_MATRIX_PARAMS } from './retroMatrix';

// Looks with a palette of their own (green rain, amber terminal, blue-to-mint code) never read the
// shared colour controls; Number Field and Dither Glow always colour between Dark and Light.
// motionOnlyByRoll: looks whose clock only steps each cell through its Roll window (no rain head, pulse or
// scroll of their own), so the card warns that Speed does nothing at Roll 0.
const OWN_PALETTE: readonly GlyphColorControl[] = ['colorMode', 'colorA', 'colorB'];

export const ascii = createGlyphEffect({ id: 'ascii', name: 'ASCII', entryPoint: 'asciiFragment', presets: ASCII_PRESETS });
export const asciiGhost = createGlyphEffect({ id: 'ascii-ghost', name: 'ASCII Ghost', entryPoint: 'asciiGhostFragment', animated: true, feedback: true, motionOnlyByRoll: true });
export const ditherText = createGlyphEffect({ id: 'dither-text', name: 'Dither Text', entryPoint: 'ditherTextFragment', animated: true, defaultCellSize: 10 });
export const wordMosaic = createGlyphEffect({ id: 'word-mosaic', name: 'Word Mosaic', entryPoint: 'wordMosaicFragment', defaultCellSize: 22, defaultRamp: 'detailed' });
export const matrix = createGlyphEffect({ id: 'matrix', name: 'Matrix Rain', entryPoint: 'matrixFragment', animated: true, defaultRamp: 'symbols', ignoresColors: OWN_PALETTE });
export const pixelCode = createGlyphEffect({ id: 'pixel-code', name: 'Pixel Code', entryPoint: 'pixelCodeFragment', defaultRamp: 'binary', defaultCellSize: 10, ignoresColors: OWN_PALETTE });
export const numberField = createGlyphEffect({ id: 'number-field', name: 'Number Field', entryPoint: 'numberFieldFragment', defaultRamp: 'numeric', ignoresColors: ['colorMode'] });
export const gridGlyph = createGlyphEffect({ id: 'grid-glyph', name: 'Grid Glyph', entryPoint: 'gridGlyphFragment' });
export const capsuleCloud = createGlyphEffect({ id: 'capsule-cloud', name: 'Tag Pills', entryPoint: 'capsuleCloudFragment', animated: true, motionOnlyByRoll: true, defaultCellSize: 28, defaultRamp: 'detailed' });
export const inscribe = createGlyphEffect({ id: 'inscribe', name: 'Inscribe', entryPoint: 'inscribeFragment', defaultRamp: 'symbols' });
export const dataHatch = createGlyphEffect({ id: 'data-hatch', name: 'Data Hatching', entryPoint: 'dataHatchFragment', animated: true, motionOnlyByRoll: true, defaultRamp: 'binary' });
export const glyphMatrix = createGlyphEffect({ id: 'glyph-matrix', name: 'Glyph Matrix', entryPoint: 'glyphMatrixFragment', animated: true, motionOnlyByRoll: true, defaultRamp: 'detailed', defaultRoll: 0.2, presets: GLYPH_MATRIX_PRESETS });
// Symbol Matrix twinkles among the neighbours of each cell's own character (Roll 0.4: four of the seven Symbols), so the picture stays in the characters.
export const symbolMatrix = createGlyphEffect({ id: 'symbol-matrix', name: 'Symbol Matrix', entryPoint: 'symbolMatrixFragment', animated: true, defaultRamp: 'symbols', defaultRoll: 0.4, presets: SYMBOL_MATRIX_PRESETS });
// Retro Matrix scrolls a fixed text up like a terminal: Roll 0.3 keeps each character near the one of its brightness,
// so the picture reads in the text, and Background 0.2 keeps the screen dark around it. Phosphor and Scanlines: retroMatrix.ts.
export const retroMatrix = createGlyphEffect({ id: 'retro-matrix', name: 'Retro Matrix', entryPoint: 'retroMatrixFragment', animated: true, defaultRamp: 'numeric', defaultRoll: 0.3, defaultBackground: 0.2, ignoresColors: OWN_PALETTE, params: RETRO_MATRIX_PARAMS, presets: RETRO_MATRIX_PRESETS });
export const pixelDither = createGlyphEffect({ id: 'pixel-dither', name: 'Dither Glow', entryPoint: 'pixelDitherFragment', animated: true, motionOnlyByRoll: true, defaultCellSize: 9, ignoresColors: ['colorMode'] });
export const brandGenerator = createGlyphEffect({ id: 'brand-generator', name: 'Brand Generator', entryPoint: 'brandGeneratorFragment', defaultCellSize: 24, defaultRamp: 'blocks' });
export const uiCollage = createGlyphEffect({ id: 'ui-collage', name: 'Creative UI Collage', entryPoint: 'uiCollageFragment', animated: true, motionOnlyByRoll: true, defaultCellSize: 18, defaultRamp: 'binary' });
// Stitch Poster draws on its own paper ground, so new instances start without the picture behind it.
export const stitchPoster = createGlyphEffect({ id: 'stitch-poster', name: 'Stitch Poster', entryPoint: 'stitchPosterFragment', defaultCellSize: 12, defaultRamp: 'symbols', defaultBackground: 0 });
