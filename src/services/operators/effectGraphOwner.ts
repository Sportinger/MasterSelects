import { createDefaultTimeStackGraph } from './timeStackEffectGraph';
import { upgradeSlitScanGraph } from './slitScanGraphUpgrade';
import { SLIT_SCAN_PROTECTION_RESOURCE } from './slitScanProtectionGraph';
import { SLIT_SCAN_TIME_MAP_RESOURCE } from './slitScanTimeMapGraph';
import { createDefaultSlitScanGraph } from './slitScanEffectGraph';
import { SLIT_SCAN_TIME_MASK_RESOURCE } from './slitScanTimeFieldsGraph';
import { composeSplatGraph } from './splatGraphComposition';
import { SPLAT_SCALAR_OPERATORS } from './splatScalarInputs';
import { defaultSplatGraph, compileSplatGraph } from './splatGraph';
import type { Effect } from '../../types/effects';
import { audioGraphOperators, compileAudioOperatorGraph, readAudioOperatorGraph } from './audioOperatorGraph';
import { AUDIO_OPERATORS } from './audioOperators';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { IMAGE_COMPOSITIONS } from './operatorCompositionRegistry';
import { expandOperatorCompositions, packOperatorCompositions } from './operatorComposition';
import { recognizeOperatorCompositions } from './recognizeOperatorCompositions';
import { cableOperatorGraph, compileCableOperatorGraph } from '../faceCables/cableOperatorGraph';
import { compileVoxelGraph, voxelOperatorGraph } from './voxelGraph';
import { isVoxelOperator, VOXEL_OPERATORS } from './voxelOperators';
import { SCENE_OPERATORS } from './sceneOperators';
import { EFFECT_OPERATORS, getEffectOperator } from './operatorRegistry';
import { EFFECT_GRAPH_PARAM, readEffectGraph, validateEffectGraph } from './effectGraph';
import { SCALAR_FIELD_OPERATORS } from './scalarField';
import { VOXEL_RELIEF_PARAMS } from '../../effects/stylize/voxel-relief/parameters';
import { compileImageOperatorGraph, createDefaultInvertImageGraph, migrateImageOperatorGraph } from './imageOperatorGraph';
import { IMAGE_OPERATORS } from './imageOperators';
import type { ImageOperatorCompileContext } from './imageOperatorChoice';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from './analogSignalGraph';
import { ANALOG_SIGNAL_OPERATORS } from './analogSignalOperators';
import { migrateAnalogSignalGraph } from './analogSignalMigration';
import { createDefaultColorEffectGraph, type EditableColorEffectType } from './colorEffectGraphs';
import { getEffect } from '../../effects';
import { createDefaultPointwiseEffectGraph, type EditablePointwiseEffectType } from './pointwiseEffectGraphs';
import { createDefaultContextualEffectGraph, type EditableContextualEffectType } from './contextualEffectGraphs';
import { createDefaultSamplingEffectGraph, type EditableSamplingEffectType } from './samplingEffectGraphs';
import { createDefaultBlockEffectGraph, type EditableBlockEffectType } from './blockEffectGraphs';
import { normalizeCatalogColor } from '../../effects/_shared/catalogColor';
import { createDefaultBlurEffectGraph, type EditableBlurEffectType } from './blurEffectGraphs';
import { createDefaultDirectionalBlurGraph, type EditableDirectionalBlurEffectType } from './directionalBlurEffectGraphs';
import { createDefaultEdgeDetectGraph } from './edgeDetectEffectGraph';
import { createDefaultGlowGraph } from './glowEffectGraph';
import { createDefaultUvDistortGraph, type EditableUvDistortEffectType } from './uvDistortEffectGraphs';
import { createDefaultFisheyeGraph } from './fisheyeEffectGraph';
import { organizeFisheyeGraph } from './fisheyeGraphPresentation';
import { organizeGaussianBlurGraph } from './gaussianBlurGraphPresentation';
import { organizeEffectFamilyGraph } from './effectFamilyPresentation';
import { normalizeFisheyeParameters } from '../../effects/distort/fisheye/normalization';
import { createDefaultCrtScreenGraph } from './crtScreenEffectGraph';
import { createDefaultRibbonScanGraph } from './ribbonScanEffectGraph';
import { createDefaultWaveLinesGraph } from './waveLinesEffectGraph';
import { createDefaultGlitchGraph } from './glitchEffectGraph';
import { createDefaultFilmPrismGraph } from './filmPrismEffectGraph';
import { createDefaultCrystalGraph } from './crystalEffectGraph';
import { createDefaultGlassDispersionGraph } from './glassDispersionEffectGraph';
import { createDefaultHalftoneGraph, type EditableHalftoneEffectType } from './halftoneEffectGraphs';
import { createDefaultHoloGraph } from './holoEffectGraph';
import { createDefaultRisoGraph, type EditableRisoEffectType } from './risoEffectGraphs';
import { createDefaultDitherGraph, type EditableDitherEffectType } from './ditherEffectGraphs';
import { createDefaultPaperPrintGraph } from './paperPrintEffectGraph';
import { createDefaultPixelPosterGraph } from './pixelPosterEffectGraph';
import { createDefaultToneGeometryGraph } from './toneGeometryEffectGraph';
import { createDefaultCrossStitchGraph } from './crossStitchEffectGraph';
import { createDefaultMotionHalftoneGraph, type EditableMotionHalftoneEffectType } from './motionHalftoneEffectGraphs';
import { createDefaultAsciiGhostGraph, createDefaultAsciiGraph, createDefaultBrandGeneratorGraph, createDefaultCapsuleCloudGraph, createDefaultDataHatchGraph, createDefaultDitherTextGraph, createDefaultGlyphMatrixGraph, createDefaultGridGlyphGraph, createDefaultInscribeGraph, createDefaultMatrixGraph, createDefaultNumberFieldGraph, createDefaultPixelCodeGraph, createDefaultPixelDitherGraph, createDefaultRetroMatrixGraph, createDefaultStitchPosterGraph, createDefaultSymbolMatrixGraph, createDefaultUiCollageGraph, createDefaultWordMosaicGraph } from './asciiEffectGraph';
import { createDefaultAcuarelaGraph } from './acuarelaEffectGraph';
import { createDefaultVoronoiGraph } from './voronoiEffectGraph';
import { createDefaultPixelSortGraph } from './pixelSortEffectGraph';
import { createDefaultQuadtreeGraph } from './quadtreeEffectGraph';
import { createDefaultContourGraph } from './contourEffectGraph';
import { createDefaultChromaKeyGraph } from './chromaKeyEffectGraph';
import { createDefaultRom1Graph } from './rom1EffectGraph';
import { createDefaultMemoryLeakGraph } from './memoryLeakEffectGraph';
import { createDefaultContourTypeGraph } from './asciiEffectGraph';
import { createDefaultGeometryFragmentGraph, type EditableGeometryFragmentEffectType } from './geometryFragmentEffectGraphs';
import { compileComputeImageGraph } from './computeImageGraph';
import { VORONOI_OPERATORS } from './voronoiOperators';

const LOCAL_IMAGE_EFFECTS = new Set(['invert', 'brightness', 'contrast', 'saturation', 'exposure', 'levels', 'hue-shift', 'temperature', 'vibrance', 'threshold', 'posterize']);
const CONTEXTUAL_IMAGE_EFFECTS = new Set(['time-stack', 'slit-scan', 'vignette', 'scanlines', 'grain', 'ascii', 'number-field', 'grid-glyph', 'pixel-code', 'word-mosaic', 'glyph-matrix', 'data-hatch', 'brand-generator', 'stitch-poster', 'dither-text', 'symbol-matrix', 'pixel-dither', 'retro-matrix', 'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost', 'inscribe', 'acuarela', 'crt-screen', 'ribbon-scan', 'wave-lines', 'glitch', 'film-prism', 'crystal', 'glass-dispersion', 'holo', 'halftone', 'pattern-halftone', 'riso', 'riso-glow', 'dither', 'dither-studio', 'paper-print', 'pixel-poster', 'tone-geometry', 'cross-stitch', 'glitch-grid', 'scatter-mosaic', 'drift-lines', 'pixelate', 'mirror', 'rgb-split', 'blockify', 'block-mosaic', 'box-blur', 'gaussian-blur', 'sharpen', 'motion-blur', 'radial-blur', 'zoom-blur', 'edge-detect', 'glow', 'wave', 'twirl', 'bulge', 'kaleidoscope', 'fisheye']);
for (const type of ['contour-map', 'crosshatch', 'kilim', 'vector-tiling', 'embroidery', 'outline', 'bricks', 'contour-type', 'chroma-key', 'rom1', 'memory-leak']) CONTEXTUAL_IMAGE_EFFECTS.add(type);
export function isLocalImageEffectType(type: string): type is 'invert' | EditableColorEffectType | EditablePointwiseEffectType { return LOCAL_IMAGE_EFFECTS.has(type); }
export function isImageGraphEffectType(type: string): type is 'time-stack' | 'slit-scan' | 'invert' | 'edge-detect' | 'glow' | 'fisheye' | 'ascii' | 'number-field' | 'grid-glyph' | 'pixel-code' | 'word-mosaic' | 'glyph-matrix' | 'data-hatch' | 'brand-generator' | 'stitch-poster' | 'dither-text' | 'symbol-matrix' | 'pixel-dither' | 'retro-matrix' | 'capsule-cloud' | 'ui-collage' | 'matrix' | 'ascii-ghost' | 'inscribe' | 'acuarela' | 'crt-screen' | 'ribbon-scan' | 'wave-lines' | 'glitch' | 'film-prism' | 'crystal' | 'glass-dispersion' | 'holo' | 'paper-print' | 'pixel-poster' | 'tone-geometry' | 'cross-stitch' | EditableMotionHalftoneEffectType | EditableHalftoneEffectType | EditableRisoEffectType | EditableDitherEffectType | EditableColorEffectType | EditablePointwiseEffectType | EditableContextualEffectType | EditableSamplingEffectType | EditableBlockEffectType | EditableBlurEffectType | EditableDirectionalBlurEffectType | EditableUvDistortEffectType | EditableGeometryFragmentEffectType | 'contour-type' | 'chroma-key' | 'rom1' | 'memory-leak' {
  return isLocalImageEffectType(type) || CONTEXTUAL_IMAGE_EFFECTS.has(type);
}
export const isComputeImageEffectType = (type: string) => type === 'voronoi' || type === 'pixel-sort' || type === 'quadtree-zoom' || type === 'contour';
export function hasEffectOperatorGraph(type: string): boolean { return type === 'splat-exploration' || type === 'audio-math' || type === 'face-cables' || type === 'voxel-relief' || isComputeImageEffectType(type) || isImageGraphEffectType(type) || type === 'analog-signal-lab'; }
type EffectGraphOwner = { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };

export function effectOperatorCompileParams(effect: Pick<EffectGraphOwner, 'params' | 'operatorGraph'>): Record<string, unknown> {
  return effect.operatorGraph
    ? { ...effect.params, [EFFECT_GRAPH_PARAM]: JSON.stringify(effect.operatorGraph) }
    : effect.params;
}

/** Supplies catalog-owned parameter metadata to image lowering without persisting schema copies in graphs. */
export function effectOperatorCompileContext(effect: Pick<EffectGraphOwner, 'type'>): ImageOperatorCompileContext {
  const definition = getEffect(effect.type);
  const context: ImageOperatorCompileContext = {
    parameterSchema: definition?.params,
    ...(effect.type === 'slit-scan' ? { namedImages: [SLIT_SCAN_PROTECTION_RESOURCE, SLIT_SCAN_TIME_MAP_RESOURCE, SLIT_SCAN_TIME_MASK_RESOURCE]
      .map(id => ({ id, sampling: 'hardware-linear-clamp' as const })) } : {}),
    ...(definition && 'usesInputHistory' in definition && definition.usesInputHistory ? { allowInputHistory: true } : {}),
    ...(definition && 'usesFeedback' in definition && definition.usesFeedback ? { allowFrameHistory: true } : {}),
    ...(effect.type === 'memory-leak' ? { allowMemoryWindow: true } : {}),
  };
  if (definition && 'glyphAtlas' in definition && definition.glyphAtlas) {
    const resolve = definition.glyphAtlas;
    context.resolveGlyphAtlas = (bindings, params) => {
      const values: Record<string, number | boolean | string> = {};
      for (const [name, binding] of Object.entries(bindings)) {
        const schema = definition.params[binding];
        if (!schema || schema.type !== (name === 'fontWeight' ? 'number' : name === 'customRamp' ? 'text' : 'select')) {
          throw new Error(`Glyph atlas binding ${binding} has no compatible owner parameter.`);
        }
        const value = params[binding] ?? schema.default;
        if ((name === 'fontWeight' && (typeof value !== 'number' || !Number.isFinite(value)))
          || (name !== 'fontWeight' && typeof value !== 'string')) {
          throw new Error(`Glyph atlas binding ${binding} has an invalid value.`);
        }
        values[name] = value as number | string;
      }
      return resolve(values);
    };
  }
  return context;
}

/**
 * Resolved image graphs per stored graph revision. The node workspace, parameter
 * sources and previews all resolve the same effect after every edit; recognition,
 * expansion and validation of a large graph ran once per caller. Stored graphs may
 * be mutated in place by render callers, so a hit also requires identical content.
 * Results are shared between callers and must be treated as read-only.
 */
const resolvedImageGraphs = new WeakMap<object, Map<string, { signature: string; params: unknown; graph: EffectOperatorGraph }>>();

export function effectOperatorGraph(effect: EffectGraphOwner, options: { inspectionOnly?: boolean } = {}): EffectOperatorGraph {
  if (effect.type === 'splat-exploration') {
    const graph = effect.operatorGraph ?? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], () => defaultSplatGraph(true).graph);
    const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
    if (errors.length) throw new Error(errors[0]);
    return expandOperatorCompositions(composeSplatGraph({ graph, params: effect.params as import('../../types/operatorGraph').SceneOperatorGraph['params'] }).graph);
  }
  if (effect.type === 'audio-math') return readAudioOperatorGraph(effect.params.operatorGraph);
  if (isComputeImageEffectType(effect.type)) {
    const fallback = effect.type === 'voronoi' ? createDefaultVoronoiGraph
      : effect.type === 'pixel-sort' ? createDefaultPixelSortGraph
        : effect.type === 'quadtree-zoom' ? createDefaultQuadtreeGraph : createDefaultContourGraph;
    const graph = effect.operatorGraph ?? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], fallback);
    const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
    if (errors.length) throw new Error(errors[0]);
    if (!graph.incomplete) compileComputeImageGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
    return graph;
  }
  if (effect.type === 'analog-signal-lab') {
    const graph = effect.operatorGraph ?? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], createDefaultAnalogSignalGraph);
    const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
    if (errors.length) throw new Error(errors[0]);
    if (!graph.incomplete) compileAnalogSignalGraph(graph, effect.params);
    return graph;
  }
  const effectType = effect.type;
  if (isImageGraphEffectType(effectType)) {
    const fallback = effectType === 'time-stack' ? createDefaultTimeStackGraph : effectType === 'slit-scan' ? createDefaultSlitScanGraph : effectType === 'invert' ? createDefaultInvertImageGraph
      : effectType === 'contour-map' || effectType === 'crosshatch' || effectType === 'kilim'
        || effectType === 'vector-tiling' || effectType === 'embroidery' || effectType === 'outline' || effectType === 'bricks'
        ? () => createDefaultGeometryFragmentGraph(effectType)
      : effectType === 'threshold' || effectType === 'posterize' ? () => createDefaultPointwiseEffectGraph(effectType)
        : effectType === 'vignette' || effectType === 'scanlines' || effectType === 'grain'
          ? () => createDefaultContextualEffectGraph(effectType)
        : effectType === 'ascii' ? createDefaultAsciiGraph
        : effectType === 'number-field' ? createDefaultNumberFieldGraph
        : effectType === 'grid-glyph' ? createDefaultGridGlyphGraph
        : effectType === 'pixel-code' ? createDefaultPixelCodeGraph
        : effectType === 'word-mosaic' ? createDefaultWordMosaicGraph
        : effectType === 'glyph-matrix' ? createDefaultGlyphMatrixGraph
        : effectType === 'data-hatch' ? createDefaultDataHatchGraph
        : effectType === 'brand-generator' ? createDefaultBrandGeneratorGraph
        : effectType === 'stitch-poster' ? createDefaultStitchPosterGraph
        : effectType === 'dither-text' ? createDefaultDitherTextGraph
        : effectType === 'symbol-matrix' ? createDefaultSymbolMatrixGraph
        : effectType === 'pixel-dither' ? createDefaultPixelDitherGraph
        : effectType === 'retro-matrix' ? createDefaultRetroMatrixGraph
        : effectType === 'capsule-cloud' ? createDefaultCapsuleCloudGraph
        : effectType === 'ui-collage' ? createDefaultUiCollageGraph
        : effectType === 'matrix' ? createDefaultMatrixGraph
        : effectType === 'ascii-ghost' ? createDefaultAsciiGhostGraph
        : effectType === 'inscribe' ? createDefaultInscribeGraph
        : effectType === 'contour-type' ? createDefaultContourTypeGraph
        : effectType === 'chroma-key' ? createDefaultChromaKeyGraph
        : effectType === 'rom1' ? createDefaultRom1Graph
        : effectType === 'memory-leak' ? createDefaultMemoryLeakGraph
        : effectType === 'acuarela' ? createDefaultAcuarelaGraph
        : effectType === 'crt-screen' ? createDefaultCrtScreenGraph
        : effectType === 'ribbon-scan' ? createDefaultRibbonScanGraph
        : effectType === 'wave-lines' ? createDefaultWaveLinesGraph
        : effectType === 'glitch' ? createDefaultGlitchGraph
        : effectType === 'film-prism' ? createDefaultFilmPrismGraph
        : effectType === 'crystal' ? createDefaultCrystalGraph
        : effectType === 'glass-dispersion' ? createDefaultGlassDispersionGraph
        : effectType === 'holo' ? createDefaultHoloGraph
        : effectType === 'riso' || effectType === 'riso-glow' ? () => createDefaultRisoGraph(effectType)
        : effectType === 'dither' || effectType === 'dither-studio' ? () => createDefaultDitherGraph(effectType)
        : effectType === 'paper-print' ? createDefaultPaperPrintGraph
        : effectType === 'pixel-poster' ? createDefaultPixelPosterGraph
        : effectType === 'tone-geometry' ? createDefaultToneGeometryGraph
        : effectType === 'cross-stitch' ? createDefaultCrossStitchGraph
        : effectType === 'glitch-grid' || effectType === 'scatter-mosaic' || effectType === 'drift-lines'
          ? () => createDefaultMotionHalftoneGraph(effectType)
        : effectType === 'halftone' || effectType === 'pattern-halftone' ? () => createDefaultHalftoneGraph(effectType)
        : effectType === 'pixelate' || effectType === 'mirror' || effectType === 'rgb-split'
          ? () => createDefaultSamplingEffectGraph(effectType)
        : effectType === 'blockify' || effectType === 'block-mosaic'
          ? () => createDefaultBlockEffectGraph(effectType)
        : effectType === 'box-blur' || effectType === 'gaussian-blur' || effectType === 'sharpen'
          ? () => createDefaultBlurEffectGraph(effectType)
        : effectType === 'motion-blur' || effectType === 'radial-blur' || effectType === 'zoom-blur'
          ? () => createDefaultDirectionalBlurGraph(effectType)
        : effectType === 'edge-detect' ? createDefaultEdgeDetectGraph
        : effectType === 'glow' ? createDefaultGlowGraph
        : effectType === 'fisheye' ? createDefaultFisheyeGraph
        : effectType === 'wave' || effectType === 'twirl' || effectType === 'bulge' || effectType === 'kaleidoscope'
          ? () => createDefaultUvDistortGraph(effectType)
        : () => createDefaultColorEffectGraph(effectType);
    const source: object = effect.operatorGraph ?? effect.params;
    const key = `${effectType}|${options.inspectionOnly ? 'inspect' : 'compile'}`, known = resolvedImageGraphs.get(source)?.get(key);
    const signature = effect.operatorGraph ? JSON.stringify(effect.operatorGraph) : String(effect.params[EFFECT_GRAPH_PARAM] ?? '');
    // Parameters only reach the compile check, so inspection ignores their identity.
    if (known && known.signature === signature && (options.inspectionOnly || known.params === effect.params)) return known.graph;
    const saved = effect.operatorGraph ?? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], fallback);
    const presented = effectType === 'slit-scan' ? upgradeSlitScanGraph(saved) : effectType === 'fisheye' ? organizeFisheyeGraph(saved)
      : effectType === 'gaussian-blur' ? organizeGaussianBlurGraph(saved) : saved;
    const composed = organizeEffectFamilyGraph(presented, recognizeOperatorCompositions(presented), effectType, fallback);
    const graph = expandOperatorCompositions(migrateImageOperatorGraph(composed));
    const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
    if (errors.length) throw new Error(errors[0]);
    if (!graph.incomplete && !options.inspectionOnly) compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
    const entries = resolvedImageGraphs.get(source) ?? new Map<string, { signature: string; params: unknown; graph: EffectOperatorGraph }>();
    entries.set(key, { signature, params: effect.params, graph });
    resolvedImageGraphs.set(source, entries);
    return graph;
  }
  const params = effectOperatorCompileParams(effect);
  if (effect.type === 'voxel-relief') return voxelOperatorGraph(params);
  if (effect.type === 'face-cables') return cableOperatorGraph(params);
  throw new Error('This effect has no operator graph.');
}

/** Converts the former JSON parameter into the canonical effect-owned field.
 * Canonical data always wins, but is still validated before it can enter runtime state. */
export function migratePersistedEffectOperatorGraph(effect: Effect): Effect {
  const legacy = effect.params[EFFECT_GRAPH_PARAM];
  if (!hasEffectOperatorGraph(effect.type)) {
    if (effect.operatorGraph || legacy !== undefined) throw new Error(`Effect ${effect.id} does not support an operator graph.`);
    return effect;
  }
  const savedGraph = effectOperatorGraph(effect);
  // Incomplete wiring remains editable; expand legacy display stages once valid.
  const graph = effect.type === 'analog-signal-lab' && !savedGraph.incomplete
    ? migrateAnalogSignalGraph(savedGraph) : savedGraph;
  const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  const packedGraph = packOperatorCompositions(graph);
  const versionedGraph: EffectOperatorGraph = {
    ...packedGraph,
    schemaVersion: 1,
    nodes: packedGraph.nodes.map(node => ({ ...node, operatorVersion: node.operatorVersion ?? 1 })),
  };
  if (!versionedGraph.incomplete) validateEffectOwnerGraph(effect, versionedGraph, effect.params);
  const params = { ...effect.params };
  delete params[EFFECT_GRAPH_PARAM];
  if (effect.type === 'grain' && params.seed === undefined) params.seed = 0;
  return { ...effect, params, operatorGraph: structuredClone(versionedGraph) };
}
export function validateEffectOwnerGraph(effect: Pick<Effect, 'type'>, graph: EffectOperatorGraph, params: Record<string, unknown>) {
  const next = { ...params, [EFFECT_GRAPH_PARAM]: JSON.stringify(graph) };
  if (effect.type === 'splat-exploration') compileSplatGraph({ graph, params: { ...defaultSplatGraph(true).params, ...params } as import('../../types/operatorGraph').SceneOperatorGraph['params'] });
  else if (effect.type === 'audio-math') compileAudioOperatorGraph(graph);
  else if (effect.type === 'voxel-relief') compileVoxelGraph(next);
  else if (effect.type === 'face-cables') compileCableOperatorGraph(next);
  else if (isImageGraphEffectType(effect.type)) compileImageOperatorGraph(graph, effectOperatorParams({ type: effect.type, params }), effectOperatorCompileContext(effect));
  else if (effect.type === 'analog-signal-lab') compileAnalogSignalGraph(graph, params);
  else if (isComputeImageEffectType(effect.type)) compileComputeImageGraph(graph, effectOperatorParams({ type: effect.type, params }), effectOperatorCompileContext(effect));
  else throw new Error('This effect has no operator graph.');
}
export function addableEffectOperators(type: string) {
  if (type === 'splat-exploration') return EFFECT_OPERATORS.filter(o => o.addable && (o.id.startsWith('splat.') || ['scene.mesh', 'material.wireframe', 'forces.gravity', 'forces.drag', 'forces.turbulence'].includes(o.id) || SPLAT_SCALAR_OPERATORS.has(o.id)));
  if (type === 'audio-math') return audioGraphOperators().filter(operator => operator.addable);
  if (isComputeImageEffectType(type)) {
    const shared = ['image.frame', 'values.number', 'values.boolean', 'values.color'].flatMap(id => {
      const operator = getEffectOperator(id); return operator ? [operator] : [];
    });
    const excluded = new Set(['image.materialize', 'image.frame-history', 'glyph.atlas', 'image.named-input', 'image.resource-input']);
    return [...(type === 'voronoi' ? VORONOI_OPERATORS.filter(operator => operator.addable) : []), ...shared,
      ...IMAGE_OPERATORS.filter(operator => operator.addable && !excluded.has(operator.id) && !operator.id.startsWith('image.derivative.'))];
  }
  if (type === 'analog-signal-lab') return [
    ...ANALOG_SIGNAL_OPERATORS.filter(operator => operator.addable),
    ...['image.frame', 'values.number'].flatMap(id => { const operator = getEffectOperator(id); return operator ? [operator] : []; }),
    ...IMAGE_OPERATORS.filter(operator => operator.addable && operator.id !== 'image.materialize' && !operator.id.startsWith('image.derivative.')),
  ];
  if (isImageGraphEffectType(type)) {
    const shared = ['image.frame', 'values.number'].flatMap(id => {
      const operator = getEffectOperator(id); return operator ? [operator] : [];
    });
    return [...shared, ...IMAGE_OPERATORS.filter(operator => operator.addable), ...IMAGE_COMPOSITIONS];
  }
  return EFFECT_OPERATORS.filter(operator => operator.addable && (type === 'voxel-relief' ? isVoxelOperator(operator.id)
    : type === 'face-cables' && !operator.composition && operator.id !== 'values.integer'
      && !AUDIO_OPERATORS.includes(operator) && !IMAGE_OPERATORS.includes(operator)
      && !SCENE_OPERATORS.includes(operator) && !VOXEL_OPERATORS.includes(operator) && !SCALAR_FIELD_OPERATORS.includes(operator)));
}

export function effectOperatorParams(effect: EffectGraphOwner): Record<string, unknown> {
  if (effect.type === 'splat-exploration') return { ...defaultSplatGraph(true).params, ...effect.params };
  if (isImageGraphEffectType(effect.type) || effect.type === 'analog-signal-lab' || isComputeImageEffectType(effect.type)) {
    const definition = getEffect(effect.type);
    const defaults = Object.fromEntries(Object.entries(definition?.params ?? {}).map(([id, spec]) => [id, spec.default]));
    const resolved = { ...defaults, ...effect.params };
    for (const [id, spec] of Object.entries(definition?.params ?? {})) {
      if (spec.type === 'color' && typeof spec.default === 'string') {
        resolved[id] = normalizeCatalogColor(resolved[id] as number | boolean | string | undefined, spec.default);
      }
    }
    if (effect.type === 'fisheye') {
      return { ...resolved, ...normalizeFisheyeParameters(resolved) };
    }
    return resolved;
  }
  if (effect.type !== 'voxel-relief') return effect.params;
  const defaults: Record<string, unknown> = Object.fromEntries(Object.entries(VOXEL_RELIEF_PARAMS).map(([id, spec]) => [id, spec.default]));
  for (const node of effectOperatorGraph(effect).nodes) for (const spec of getEffectOperator(node.operator)!.parameters) {
    const binding = node.bindings[spec.id];
    if (typeof binding === 'string' && defaults[binding] === undefined) defaults[binding] = spec.default;
  }
  return { ...defaults, ...effect.params };
}
export function canRemoveEffectOperator(type: string, nodeId: string, operatorId: string): boolean {
  if (type === 'splat-exploration') return !!addableEffectOperators(type).find(o => o.id === operatorId);
  if (type === 'audio-math') return !['audio.input', 'audio.output'].includes(operatorId);
  if (isComputeImageEffectType(type)) return !['frame', 'output'].includes(nodeId) && !!getEffectOperator(operatorId)?.addable;
  if (type === 'analog-signal-lab') return !['frame', 'output'].includes(nodeId) && !!getEffectOperator(operatorId)?.addable;
  return type === 'voxel-relief' ? operatorId !== 'render.voxel' && operatorId !== 'image.frame'
    : nodeId !== 'wind' && !!getEffectOperator(operatorId)?.addable;
}
