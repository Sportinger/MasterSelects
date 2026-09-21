import common from '../../src/effects/_shared/commonShader';
import { invert } from '../../src/effects/color/invert';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { checkImageCompositeGpu } from './image-composite-gpu-check';
import { checkWorkerImageGraphGpu } from './image-worker-gpu-check';
import { checkRemainingColorEffectsGpu } from './image-color-effects-gpu-check';
import { checkPointwiseEffectsGpu } from './image-pointwise-effects-gpu-check';
import { checkVignetteGpu } from './image-vignette-gpu-check';
import { checkTimeEffectsGpu } from './image-time-effects-gpu-check';
import { checkSamplingEffectsGpu } from './image-sampling-effects-gpu-check';
import { checkBlockEffectsGpu } from './image-block-effects-gpu-check';
import { checkBlurEffectsGpu } from './image-blur-effects-gpu-check';
import { checkImageMaterializationGpu } from './image-materialization-gpu-check';
import { checkDirectionalBlurGpu } from './image-directional-blur-gpu-check';
import { checkEdgeDetectGpu } from './image-edge-detect-gpu-check';
import { checkGlowGpu } from './image-glow-gpu-check';
import { checkUvDistortGpu } from './image-uv-distort-gpu-check';
import { checkImageOpticsGpu } from './image-optics-gpu-check';
import { checkImageReducerBranchesGpu } from './image-reducer-branch-gpu-check';
import { checkFisheyeGraphGpu } from './image-fisheye-graph-gpu-check';
import { checkImageNamedInputsGpu } from './image-named-inputs-gpu-check';
import { checkAnalogDisplayResolveGpu } from './analog-display-resolve-gpu-check';
import { checkImageChoiceGpu } from './image-choice-gpu-check';
import { checkCrtScreenGraphGpu } from './image-crt-screen-gpu-check';
import { checkRibbonScanGraphGpu } from './image-ribbon-scan-gpu-check';
import { checkWaveLinesGraphGpu } from './image-wave-lines-gpu-check';
import { checkGlitchGraphGpu } from './image-glitch-graph-gpu-check';
import { checkFilmPrismGraphGpu } from './image-film-prism-gpu-check';
import { checkGlassGraphsGpu } from './image-glass-graphs-gpu-check';
import { checkHoloDerivativesGpu } from './image-holo-derivatives-gpu-check';
import { checkHalftoneGraphsGpu } from './image-halftone-graphs-gpu-check';
import { checkHoloGraphGpu } from './image-holo-graph-gpu-check';
import { checkRisoGraphsGpu } from './image-riso-graphs-gpu-check';
import { checkDitherGraphsGpu } from './image-dither-graphs-gpu-check';
import { checkPrintGraphsGpu } from './image-print-graphs-gpu-check';
import { checkHalftonePatternsGpu } from './image-halftone-patterns-gpu-check';
import { checkAsciiGraphGpu, checkContourTypeGraphGpu } from './image-ascii-graph-gpu-check';
import { checkFeedbackHistoryGpu } from './feedback-history-gpu-check';
import { checkAcuarelaGraphGpu } from './image-acuarela-graph-gpu-check';
import { checkGlyphFeedbackHistoryGpu } from './glyph-feedback-history-gpu-check';
import { checkImagePixelLoadGpu } from './image-pixel-load-gpu-check';
import { checkImageSeedFieldGpu } from './image-seed-field-gpu-check';
import { checkComputeVoronoiGraphGpu } from './compute-voronoi-graph-gpu-check';
import { checkComputePixelSortGraphGpu } from './compute-pixel-sort-graph-gpu-check';
import { checkComputeQuadtreeGraphGpu } from './compute-quadtree-graph-gpu-check';
import { checkComputeContourGraphGpu } from './compute-contour-graph-gpu-check';
import { checkImageGeometryPatternsGpu } from './image-geometry-patterns-gpu-check';
import { checkChromaKeyGraphGpu } from './image-chroma-key-graph-gpu-check';
import { checkRom1GraphGpu } from './image-rom1-graph-gpu-check';
import { checkMemoryLeakGraphGpu } from './image-memory-leak-graph-gpu-check';

async function checkGpu() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const suite = new URLSearchParams(location.search).get('suite');
  if (suite === 'memory-leak') {
    try {
      const comparisons = await checkMemoryLeakGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Memory Leak graph comparisons; strict legacy RGBA8 parity and uint resource bindings; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'rom1') {
    try {
      const comparisons = await checkRom1GraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} ROM1 comparisons; strict legacy RGBA8 parity, timeline, extrema, history alpha, and bypass verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'chroma-key') {
    try {
      const comparisons = await checkChromaKeyGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Chroma Key comparisons; strict legacy RGBA8 parity, key choices, extrema, alpha, and bypass verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'contour-type') {
    try {
      const comparisons = await checkContourTypeGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Contour Type comparisons; strict legacy RGBA8 parity and glyph atlas verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'geometry-patterns' || suite === 'geometry-patterns-next') {
    try {
      const comparisons = suite === 'geometry-patterns-next'
        ? await checkImageGeometryPatternsGpu(device, ['vector-tiling', 'embroidery', 'outline', 'bricks'])
          + await checkImageGeometryPatternsGpu(device, ['contour-map', 'crosshatch', 'kilim'], ['minimums'])
        : await checkImageGeometryPatternsGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} geometry pattern comparisons; strict legacy RGBA8 parity, extrema, colors, alpha, and direct output verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'compute-contour') {
    try {
      const comparisons = await checkComputeContourGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Contour compute graph comparisons; strict legacy RGBA8 parity, ambiguous topology, equality, colors, alpha, and direct output verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'compute-quadtree') {
    try {
      const comparisons = await checkComputeQuadtreeGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Quadtree compute graph comparisons; strict legacy RGBA8 parity, time, extrema, variance, edges, alpha, and direct output verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'compute-pixel-sort') {
    try {
      const comparisons = await checkComputePixelSortGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Pixel Sort compute graph comparisons; strict legacy RGBA8 parity, stable ties, partial segments, threshold, alpha, bypass, and compute-only output verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'compute-voronoi') {
    try {
      const comparisons = await checkComputeVoronoiGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Voronoi compute graph comparisons; strict legacy RGBA8 parity, staged constants, seed-only rewiring, direct passthrough, and alpha verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'seed-field') {
    try {
      const comparisons = await checkImageSeedFieldGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} raw RGBA16F seed-field comparisons; negative and above-one records, truncation, and clamp verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'pixel-load') {
    try {
      const comparisons = await checkImagePixelLoadGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} pixel-load comparisons; texture and VideoFrame external integer truncation, clamp, exact RGBA, and graph rewrite verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'glyph-feedback-history') {
    try {
      const comparisons = await checkGlyphFeedbackHistoryGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} ASCII Ghost pipeline history checks; canonical atlas/history resources, hold, advance, seek, reset, and continuous loop verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'acuarela-graph') {
    try {
      const comparisons = await checkAcuarelaGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Acuarela graph comparisons; strict legacy RGBA8 parity, explicit history, timeline time, alpha, and direct rewire verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'feedback-history') {
    try {
      const comparisons = await checkFeedbackHistoryGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} feedback history GPU checks; hold, advance, seek, loops, owner edits and export reset verified.`;
    } finally { device.destroy(); }
  }
  if (suite === 'ascii') {
    try {
      const comparisons = await checkAsciiGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} ASCII graph comparisons; strict legacy RGBA8 parity, shared glyph-atlas resources, per-effect alpha semantics, and direct rewire verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'halftone-patterns') {
    try {
      const comparisons = await checkHalftonePatternsGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Halftone pattern graph comparisons; strict legacy RGBA8 parity, shapes, timeline cases, sampled alpha, and direct rewires verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'print-graphs') {
    try {
      const comparisons = await checkPrintGraphsGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} print graph comparisons; strict legacy RGBA8 parity, pixel sampling, bypass/direct rewires, and variable alpha verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'dither-graphs') {
    try {
      const comparisons = await checkDitherGraphsGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Dither graph comparisons; strict legacy RGBA8 parity, all kernels, bypass/direct rewires, and variable alpha verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'riso-graphs') {
    try {
      const comparisons = await checkRisoGraphsGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Riso graph comparisons; strict legacy RGBA8 parity, bypass/direct rewires, and variable alpha verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'holo-graph') {
    try {
      const comparisons = await checkHoloGraphGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Holo graph comparisons; strict legacy RGBA8 parity, variable alpha, and direct rewire verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'halftone-graphs') {
    try {
      const comparisons = await checkHalftoneGraphsGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} Halftone graph comparisons; legacy byte parity, bypass/direct rewires, and variable alpha verified; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'holo-derivatives') {
    try {
      const evidence = await checkHoloDerivativesGpu(device);
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: Holo derivative evidence only — ${evidence}; no validation errors.`;
    } finally { device.destroy(); }
  }
  if (suite === 'fisheye' || suite === 'named-inputs' || suite === 'analog-display' || suite === 'crt-screen' || suite === 'ribbon-scan' || suite === 'wave-lines' || suite === 'glitch' || suite === 'film-prism' || suite === 'glass-graphs') {
    try {
      const acceptedRounding: string[] = [];
      const comparisons = await (suite === 'fisheye' ? checkFisheyeGraphGpu(device, detail => acceptedRounding.push(detail))
        : suite === 'analog-display' ? checkAnalogDisplayResolveGpu(device)
          : suite === 'crt-screen' ? checkCrtScreenGraphGpu(device)
            : suite === 'ribbon-scan' ? checkRibbonScanGraphGpu(device)
              : suite === 'wave-lines' ? checkWaveLinesGraphGpu(device)
                : suite === 'glitch' ? checkGlitchGraphGpu(device)
                  : suite === 'film-prism' ? checkFilmPrismGraphGpu(device)
                    : suite === 'glass-graphs' ? checkGlassGraphsGpu(device) : checkImageNamedInputsGpu(device));
      const validation = await device.popErrorScope();
      if (validation) throw new Error(validation.message);
      return `PASS: ${comparisons} ${suite} graph comparisons; no validation errors.${acceptedRounding.length ? ` Approved rounding: ${acceptedRounding.join('; ')}.` : ''}`;
    } finally { device.destroy(); }
  }
  const size = 64;
  const pixels = new Uint8Array(size * 4);
  for (let x = 0; x < size; x++) pixels.set([x * 4, 255 - x * 4, 37, x * 4], x * 4);
  const source = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, 1]);
  const target = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  const base = { id: 'gpu-fixture', type: 'invert' as const, params: {} };
  const bypass = createDefaultInvertImageGraph();
  bypass.nodes.filter(node => node.id.startsWith('invert-')).forEach(node => { node.bypassed = true; });
  const direct = createDefaultInvertImageGraph();
  direct.edges = direct.edges.filter(edge => edge.to !== 'output');
  direct.edges.push({ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' });
  const definitions = [invert as FullscreenEffectDefinition,
    imageGraphDefinition(base, invert as FullscreenEffectDefinition),
    imageGraphDefinition({ ...base, operatorGraph: bypass }, invert as FullscreenEffectDefinition),
    imageGraphDefinition({ ...base, operatorGraph: direct }, invert as FullscreenEffectDefinition)];
  const results: Uint8Array[] = [];
  try {
    for (const definition of definitions) {
      const module = device.createShaderModule({ code: common + '\n' + definition.shader });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
      const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
      const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: sampler }, { binding: 1, resource: source.createView() },
      ] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      // common.wgsl defines a six-vertex fullscreen quad, not the compositor's three-vertex triangle.
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(6); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: size * 4 }, [size, 1]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      results.push(new Uint8Array(readback.getMappedRange()).slice()); readback.unmap();
    }
    const equal = (a: Uint8Array, b: Uint8Array) => a.every((value, i) => value === b[i]);
    const mismatch = (a: Uint8Array, b: Uint8Array) => {
      const index = a.findIndex((value, i) => value !== b[i]);
      return index < 0 ? 'none' : `byte ${index} (pixel ${Math.floor(index / 4)}, channel ${index % 4}): actual=${a[index]}, expected=${b[index]}`;
    };
    if (!equal(results[0], results[1])) throw new Error('Default graph differs from legacy shader');
    if (!equal(results[2], pixels)) throw new Error(`Bypass output differs from input at ${mismatch(results[2], pixels)}`);
    if (!equal(results[3], pixels)) throw new Error(`Direct output differs from input at ${mismatch(results[3], pixels)}`);
    if (equal(results[0], results[2])) throw new Error('Graph edit did not change pixels');
    const opaque = pixels.slice();
    for (let index = 3; index < opaque.length; index += 4) opaque[index] = 255;
    await checkImageCompositeGpu(device, sampler, opaque, size);
    await checkImageCompositeGpu(device, sampler, pixels, size);
    const colorComparisons = await checkRemainingColorEffectsGpu(device, sampler, pixels, size);
    if (colorComparisons !== 10) throw new Error(`Expected 10 remaining color comparisons, got ${colorComparisons}`);
    const pointwiseComparisons = await checkPointwiseEffectsGpu(device, sampler);
    const vignetteComparisons = await checkVignetteGpu(device, sampler);
    const timeComparisons = await checkTimeEffectsGpu(device, sampler);
    const samplingComparisons = await checkSamplingEffectsGpu(device, sampler);
    const blockComparisons = await checkBlockEffectsGpu(device, sampler);
    const blurComparisons = await checkBlurEffectsGpu(device);
    const materializationComparisons = await checkImageMaterializationGpu(device);
    const directionalBlurComparisons = await checkDirectionalBlurGpu(device);
    const edgeDetectComparisons = await checkEdgeDetectGpu(device);
    const glowComparisons = await checkGlowGpu(device);
    const uvDistortComparisons = await checkUvDistortGpu(device);
    const opticsComparisons = await checkImageOpticsGpu(device);
    const choiceComparisons = await checkImageChoiceGpu(device);
    if (choiceComparisons !== 4) throw new Error(`Expected 4 choice comparisons, got ${choiceComparisons}`);
    const reducerBranchComparisons = await checkImageReducerBranchesGpu(device);
    const fisheyeGraphComparisons = await checkFisheyeGraphGpu(device);
    await checkImageNamedInputsGpu(device);
    const workerResult = `${await checkWorkerImageGraphGpu(device)}; ${colorComparisons} remaining-color, ${pointwiseComparisons} pointwise, ${vignetteComparisons} vignette, ${timeComparisons} time-effect, ${samplingComparisons} sampling-effect, ${blockComparisons} block-effect, ${blurComparisons} blur, ${materializationComparisons} materialization, ${directionalBlurComparisons} directional-blur, ${edgeDetectComparisons} edge-detect, ${glowComparisons} Glow, ${uvDistortComparisons} UV-distort, ${opticsComparisons} optics, ${choiceComparisons} choice, ${reducerBranchComparisons} reducer-branch, and ${fisheyeGraphComparisons} Fisheye-graph shader comparisons`;
    const validation = await device.popErrorScope();
    if (validation) throw new Error(validation.message);
    return `PASS: 64 RGBA pixels — legacy/default byte equality; bypass and rewired output equal input; alpha preserved; actual GPU output changes; ${workerResult}; no validation errors.`;
  } finally { source.destroy(); target.destroy(); readback.destroy(); device.destroy(); }
}

document.getElementById('run')!.addEventListener('click', async () => {
  const result = document.getElementById('result')!;
  result.textContent = 'Running…';
  try { result.textContent = await checkGpu(); } catch (error) { result.textContent = `FAIL: ${error}`; }
});
