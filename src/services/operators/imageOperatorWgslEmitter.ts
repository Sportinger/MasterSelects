import type { ImageOperatorCapability, ImageOperatorSampleScope, ImagePlanInstruction } from './imageOperatorGraph';
import type { ImageOperatorResourceSampling } from './imageOperatorResources';
import { emitImageReducerWgsl } from './imageOperatorReducerWgsl';
import { pointwiseOperation } from './fields/pointwiseOperations';
import { imageF32 as f32, imageParameterExpression as parameterExpression, IMAGE_COLOR_WGSL, IMAGE_COORDINATE_ROTATION_WGSL, IMAGE_GAUSSIAN_WGSL, IMAGE_HASH2D_WGSL, IMAGE_PARAMETER_WGSL, IMAGE_RADIAL_PROJECTION_WGSL, IMAGE_VECTOR_WGSL } from './imageOperatorWgsl';
import { INPUT_HISTORY_SAMPLE_WGSL } from './inputHistorySampling';
import { OPTICAL_FLOW_WGSL, HISTORY_OPTICAL_FLOW_WGSL } from './opticalFlowWgsl';
import { MOTION_IMAGE_WGSL } from './motionImageWgsl';
import { IMAGE_BAYER_4_WGSL } from './imagePatternSemantics';
import { emitImageSegmentSortWgsl, IMAGE_SEGMENT_SORT_WGSL } from './imageOperatorSegmentSortWgsl';
import { emitImageQuadtreeWgsl } from './imageOperatorQuadtreeWgsl';
import { imageSampleScopeNeedsSource, imageScopeReadsPrimaryInput } from './imageOperatorScopes';
import { IMAGE_MARCHING_SQUARES_TOPOLOGY_WGSL } from './imageOperatorTopologyWgsl';

const hash = (value: string) => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 0x01000193); }
  return (result >>> 0).toString(16).padStart(8, '0');
};
interface ReducerScope { id: number; sample: number; weight: number; blend?: boolean }
export function emitImageOperatorWgsl(input: { instructions: ImagePlanInstruction[]; output: number; capabilities: ImageOperatorCapability[];
  sampleScopes: ImageOperatorSampleScope[]; kernelScopes: ReducerScope[]; rectScopes: ReducerScope[]; sequenceScopes: ReducerScope[];
  segmentSortScopes: readonly { id: number; sample: number }[];
  quadtreeScopes: readonly { id: number; sample: number }[];
  parameterValues: number[]; resourceInputs: string[]; resourceSampling: ImageOperatorResourceSampling[] }) {
  const { instructions, output, capabilities, sampleScopes, kernelScopes, rectScopes, sequenceScopes, segmentSortScopes, quadtreeScopes, parameterValues, resourceInputs, resourceSampling } = input;
  const contextCallArgs = (uv: string) => [uv,
    ...(capabilities.includes('resolution') ? ['inputResolution'] : []),
    ...(capabilities.includes('time') ? ['timelineTimeSeconds'] : []),
    ...(parameterValues.length ? ['imageParameters'] : [])].join(', ');
  const sampleScopeById = new Map(sampleScopes.map(scope => [scope.id, scope]));
  const reducerCallArgs = (scope: number) => {
    const capture = sampleScopeById.get(scope)?.reducerContext;
    return capture?.kind === 'kernel' ? ', kernelIndex' : capture?.kind === 'sequence' ? ', sequenceIndex, sequenceT' : '';
  };
  const expressions = instructions.map((item, index) => {
    const args = item.inputs.map(input => `v${input}`);
    const pointwise = pointwiseOperation(item.operation);
    const expression = pointwise ? pointwise.wgsl(args, item.value) : item.operation === 'input' ? 'pixel' : item.operation === 'uv' ? 'inputUv'
      : item.operation === 'sample-input-history' ? `${args.length > 3 ? 'sampleInputHistoryMotion' : 'sampleInputHistory'}(imageGraphResource${item.resourceSlots![0]}, imageGraphResource${item.resourceSlots![1]}, texSampler, ${args.join(', ')}, inputUv)`
      : item.operation === 'optical-flow' ? `imageOpticalFlow(imageGraphResource${item.resourceSlots![0]}, imageGraphResource${item.resourceSlots![1]}, texSampler, inputUv, ${args[0]}, inputResolution)`
      : item.operation === 'source-motion' ? `imageHistoryOpticalFlow(imageGraphResource${item.resourceSlots![0]}, imageGraphResource${item.resourceSlots![1]}, texSampler, ${args.join(', ')}, inputResolution)`
      : item.operation === 'motion-consistency' ? `motionSpatialConsensus(imageGraphResource${item.resourceSlots![0]}, texSampler, inputUv, ${args[0]}, inputResolution)`
      : item.operation === 'directional-smooth' ? `motionDirectionalSmooth(imageGraphResource${item.resourceSlots![0]}, texSampler, inputUv, ${args.join(', ')}, inputResolution)`
      : item.operation === 'temporal-deformation' ? `motionTemporalDeformation(${args.join(', ')})`
      : item.operation === 'mask-overlay' ? `motionMaskOverlay(${args.join(', ')})`
      : item.operation === 'resource-input' ? `sampleImageGraphResource${item.value}(inputUv)`
      : item.operation === 'resource-load-input' ? `loadImageGraphResource${item.value}(inputPixel)`
      : item.operation === 'field-load-nearest-seed' ? `loadImageGraphResource${item.value}(imageGraphPixelCoordinate(${args[0]}, inputResolution))`
      : item.operation === 'resource-metadata' ? `imageGraphResourceMetadata${item.value}()`
      : item.operation === 'byte-pixel-decode' ? `decodeImageGraphBytePixel${item.value}(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`
      : item.operation === 'kernel-index' ? 'kernelIndex' : item.operation === 'sequence-index' ? 'sequenceIndex' : item.operation === 'sequence-t' ? 'sequenceT' : item.operation === 'resolution' ? 'inputResolution'
      : item.operation === 'time' ? 'timelineTimeSeconds'
      : item.operation === 'derivative-auto' ? `vec2f(dpdx(${args[0]}), dpdy(${args[0]}))`
      : item.operation === 'derivative-fine' ? `vec2f(dpdxFine(${args[0]}), dpdyFine(${args[0]}))`
      : item.operation === 'derivative-coarse' ? `vec2f(dpdxCoarse(${args[0]}), dpdyCoarse(${args[0]}))`
      : item.operation === 'sample-image'
        ? `evaluateImageScope${item.value}(${imageSampleScopeNeedsSource(instructions, item.value!) ? `sampleImageGraphSource(${args[0]})` : 'vec4f(0.0)'}, ${contextCallArgs(args[0])}${reducerCallArgs(item.value!)})`
      : item.operation === 'load-image'
        ? `evaluateImageScope${item.value}(${imageScopeReadsPrimaryInput(instructions, item.value!) ? `loadImageGraphSource(imageGraphPixelCoordinate(${args[0]}, inputResolution))` : 'vec4f(0.0)'}, (vec2f(imageGraphPixelCoordinate(${args[0]}, inputResolution)) + 0.5) / inputResolution, imageGraphPixelCoordinate(${args[0]}, inputResolution)${capabilities.includes('resolution') ? ', inputResolution' : ''}${capabilities.includes('time') ? ', timelineTimeSeconds' : ''}${parameterValues.length ? ', imageParameters' : ''}${reducerCallArgs(item.value!)})`
      : item.operation === 'kernel-sum' ? `imageKernelReduce${item.value}(${args[0]}, pixel, inputUv${capabilities.includes('resolution') ? ', inputResolution' : ''}${capabilities.includes('time') ? ', timelineTimeSeconds' : ''}${parameterValues.length ? ', imageParameters' : ''})`
      : item.operation === 'segment-sort-luma' ? `imageSegmentSort${item.value}(${args[0]}, inputUv, inputResolution${capabilities.includes('time') ? ', timelineTimeSeconds' : ''}${parameterValues.length ? ', imageParameters' : ''})`
      : item.operation === 'quadtree-partition' ? `imageQuadtreePartition${item.value}(${args.join(', ')}, inputUv, inputResolution${capabilities.includes('time') ? ', timelineTimeSeconds' : ''}${parameterValues.length ? ', imageParameters' : ''})`
      : item.operation === 'quadtree-origin' ? `${args[0]}.xy` : item.operation === 'quadtree-size' ? `${args[0]}.z`
      : item.operation === 'marching-squares-topology' ? `imageMarchingSquaresTopology(vec4f(${args.slice(0, 4).join(', ')}), ${args.slice(4).join(', ')})`
      : item.operation.startsWith('marching-squares-') ? item.operation === 'marching-squares-count'
        ? `f32(topologyResult${item.inputs[0]}.count)` : `topologyResult${item.inputs[0]}.${item.operation.at(-1)}`
      : item.operation === 'kernel-weight-sum' ? `kernelResult${item.inputs[0]}.weightSum`
      : item.operation === 'rect-sum' ? `imageRectReduce${item.value}(${args[0]}, ${args[1]}, pixel, inputUv${capabilities.includes('resolution') ? ', inputResolution' : ''}${capabilities.includes('time') ? ', timelineTimeSeconds' : ''}${parameterValues.length ? ', imageParameters' : ''})`
      : item.operation === 'rect-weight-sum' ? `rectResult${item.inputs[0]}.weightSum`
      : item.operation === 'sequence-sum' ? `imageSequenceReduce${item.value}(${args.join(', ')}, pixel, inputUv${capabilities.includes('resolution') ? ', inputResolution' : ''}${capabilities.includes('time') ? ', timelineTimeSeconds' : ''}${parameterValues.length ? ', imageParameters' : ''})`
      : item.operation === 'sequence-weight-sum' ? `sequenceResult${item.inputs[0]}.weightSum`
      : item.operation === 'select-image' || item.operation === 'select-lazy-scalar' ? 'lazy-selection'
      : item.operation === 'constant' ? item.type === 'boolean' ? (item.value ? 'true' : 'false') : f32(item.value ?? 0)
      : item.operation === 'parameter' ? parameterExpression(item.value ?? 0)
      : item.operation === 'parameter-boolean' ? `${parameterExpression(item.value ?? 0)} > 0.5`
      : item.operation === 'parameter-color' ? `vec4f(${[0, 1, 2, 3].map(offset => parameterExpression((item.value ?? 0) + offset)).join(', ')})`
      : item.operation === 'constant-color' ? `vec4f(${item.color!.map(f32).join(', ')})`
      : item.operation === 'gaussian-scalar' ? `imageGraphGaussian(${args[0]}, ${args[1]})`
      : item.operation === 'degrees-to-radians' ? `${args[0]} * ${f32(Math.PI)} / 180.0`
      : item.operation === 'rotate-vec2' ? `imageRotate2d(${args[0]}, ${args[1]})`
      : item.operation === 'integer-cell-origin' ? `vec2f((vec2i(${args[0]}) / i32(${args[1]})) * i32(${args[1]}))`
      : item.operation === 'normalize-vec2' ? `imageGraphNormalize2(${args[0]})`
      : item.operation === 'bayer4-vec2' ? `imageGraphBayer4(${args[0]})`
      : item.operation === 'project-radius' ? `imageGraphProjectRadius(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'unproject-radius' ? `imageGraphUnprojectRadius(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'hash2d-vec2' ? `imageGraphHash2d(${args[0]})`
      : item.operation === 'rgb-to-hsv' ? `imageGraphRgbToHsv(${args[0]})` : item.operation === 'hsv-to-rgb' ? `imageGraphHsvToRgb(${args[0]})`
      : `vec4f(${args[0]}, ${args[1]})`;
    const type = item.type === 'image' || item.type === 'vec4' ? 'vec4f' : item.type === 'rgb' || item.type === 'vec3' ? 'vec3f' : item.type === 'vec2' ? 'vec2f' : item.type === 'boolean' ? 'bool' : 'f32';
    if (item.operation === 'kernel-sum') return `  let kernelResult${index} = ${expression};\n  let v${index}: vec4f = kernelResult${index}.sum;`;
    if (item.operation === 'rect-sum') return `  let rectResult${index} = ${expression};\n  let v${index}: vec4f = rectResult${index}.sum;`;
    if (item.operation === 'sequence-sum') return `  let sequenceResult${index} = ${expression};\n  let v${index}: vec4f = sequenceResult${index}.sum;`;
    if (item.operation === 'marching-squares-topology') return `  let topologyResult${index} = ${expression};\n  let v${index}: vec4f = vec4f(0.0);`;
    if (item.operation === 'select-image' || item.operation === 'select-lazy-scalar') return 'lazy-selection';
    return `  let v${index}: ${type} = ${expression};`;
  });
  const isLazySelect = (item: ImagePlanInstruction) => item.operation === 'select-image' || item.operation === 'select-lazy-scalar';
  const selectScopeIds = new Set(instructions.filter(isLazySelect).flatMap(item => item.inputs.slice(1)));
  const scopedLines = (scope: number, indent: string): string[] => instructions.flatMap((item, index) => item.scope !== scope ? []
    : [isLazySelect(item) ? renderSelect(index, indent) : expressions[index].replace(/^  /gm, indent)]);
  function renderSelect(index: number, indent: string): string {
    const item = instructions[index], condition = `v${item.inputs[0]}`, branch = (scope: number) => [
      ...scopedLines(scope, `${indent}  `), `${indent}  v${index} = v${sampleScopes.find(candidate => candidate.id === scope)!.output};`,
    ].join('\n');
    const type = item.type === 'image' ? 'vec4f' : 'f32';
    return `${indent}var v${index}: ${type};\n${indent}if (${condition}) {\n${branch(item.inputs[2])}\n${indent}} else {\n${branch(item.inputs[1])}\n${indent}}`;
  }
  instructions.forEach((item, index) => { if (isLazySelect(item)) expressions[index] = renderSelect(index, '  '); });
  const outputType = instructions[output].type;
  const canonical = JSON.stringify({ emitterVersion: 5, capabilities, instructions: instructions.map(({ nodeId: _nodeId, ...instruction }) => instruction), sampleScopes, kernelScopes, rectScopes, sequenceScopes, segmentSortScopes, quadtreeScopes, output, outputType });
  const returned = outputType === 'image' || outputType === 'vec4' ? `v${output}` : outputType === 'rgb' || outputType === 'vec3' ? `vec4f(v${output}, 1.0)`
    : outputType === 'vec2' ? `vec4f(v${output}, 0.0, 1.0)`
    : outputType === 'boolean' ? `vec4f(vec3f(select(0.0, 1.0, v${output})), 1.0)`
    : outputType === 'alpha' || outputType === 'scalar' ? `vec4f(v${output}, v${output}, v${output}, 1.0)` : `v${output}`;
  const parameters = ['inputColor: vec4f'];
  if (capabilities.includes('uv')) parameters.push('inputUv: vec2f');
  if (capabilities.includes('resolution')) parameters.push('inputResolution: vec2f');
  if (capabilities.includes('time')) parameters.push('timelineTimeSeconds: f32');
  if (parameterValues.length) parameters.push('imageParameters: ImageOperatorParameters');
  const scopeParameters = ['inputColor: vec4f', 'inputUv: vec2f'];
  if (capabilities.includes('resolution')) scopeParameters.push('inputResolution: vec2f');
  if (capabilities.includes('time')) scopeParameters.push('timelineTimeSeconds: f32');
  if (parameterValues.length) scopeParameters.push('imageParameters: ImageOperatorParameters');
  const scopeFunctions = sampleScopes.filter(scope => !selectScopeIds.has(scope.id)).toSorted((a, b) => b.id - a.id).map(scope => [
    `fn evaluateImageScope${scope.id}(${[...scopeParameters.slice(0, 2), ...(scope.coordinate === 'pixel' ? ['inputPixel: vec2i'] : []), ...scopeParameters.slice(2),
      ...(scope.reducerContext?.kind === 'kernel' ? ['kernelIndex: vec2f'] : scope.reducerContext?.kind === 'sequence' ? ['sequenceIndex: f32', 'sequenceT: f32'] : []),
    ].join(', ')}) -> vec4f {`, '  let pixel = inputColor;',
    ...expressions.filter((_line, index) => instructions[index].scope === scope.id), `  return v${scope.output};`, '}',
  ].join('\n'));
  const reducerWgsl = emitImageReducerWgsl({ instructions, expressions, kernelScopes, rectScopes, sequenceScopes, scopeParameters, capabilities, hasParameters: !!parameterValues.length });
  const segmentSortWgsl = emitImageSegmentSortWgsl({ instructions, sampleScopes, segmentSortScopes, capabilities, hasParameters: !!parameterValues.length });
  const quadtreeWgsl = emitImageQuadtreeWgsl({ instructions, sampleScopes, quadtreeScopes, capabilities, hasParameters: !!parameterValues.length });
  const pixelLoadWgsl = capabilities.includes('pixel-load') ? 'fn imageGraphPixelCoordinate(pixel: vec2f, resolution: vec2f) -> vec2i { return clamp(vec2i(pixel), vec2i(0), vec2i(resolution) - 1); }' : '';
  const wgsl = [...(instructions.some(item => item.operation === 'sample-input-history' || item.operation === 'source-motion') ? [INPUT_HISTORY_SAMPLE_WGSL] : []),
      ...(instructions.some(item => item.operation === 'source-motion') ? [HISTORY_OPTICAL_FLOW_WGSL] : []),
      ...(instructions.some(item => item.operation === 'optical-flow') ? [OPTICAL_FLOW_WGSL] : []),
      ...(instructions.some(item => ['directional-smooth', 'motion-consistency', 'temporal-deformation', 'mask-overlay'].includes(item.operation)) ? [MOTION_IMAGE_WGSL] : []),
      IMAGE_COLOR_WGSL, pixelLoadWgsl, ...(instructions.some(item => item.operation === 'hash2d-vec2') ? [IMAGE_HASH2D_WGSL] : []),
      ...(instructions.some(item => item.operation === 'gaussian-scalar') ? [IMAGE_GAUSSIAN_WGSL] : []), ...(parameterValues.length ? [IMAGE_PARAMETER_WGSL] : []),
      ...(instructions.some(item => item.operation === 'rotate-vec2') ? [IMAGE_COORDINATE_ROTATION_WGSL] : []),
      ...(instructions.some(item => item.operation === 'normalize-vec2') ? [IMAGE_VECTOR_WGSL] : []),
      ...(instructions.some(item => item.operation === 'bayer4-vec2') ? [IMAGE_BAYER_4_WGSL] : []),
      ...(segmentSortScopes.length ? [IMAGE_SEGMENT_SORT_WGSL] : []),
      ...(instructions.some(item => item.operation === 'marching-squares-topology') ? [IMAGE_MARCHING_SQUARES_TOPOLOGY_WGSL] : []),
      ...(instructions.some(item => item.operation === 'project-radius' || item.operation === 'unproject-radius') ? [IMAGE_RADIAL_PROJECTION_WGSL] : []),
      ...scopeFunctions, segmentSortWgsl, ...quadtreeWgsl, ...reducerWgsl, `fn evaluateImageGraph(${parameters.join(', ')}) -> vec4f {`, `  let pixel = inputColor;`,
      ...expressions.filter((_line, index) => instructions[index].scope === 0), `  return ${returned};`, `}`].join('\n');
  // GPU owners survive HMR. A helper implementation change must invalidate the
  // pipeline too, even when the graph and its resource bindings are unchanged.
  const key = `image-v1-${hash(JSON.stringify({ canonical, resourceInputs, resourceSampling, wgsl }))}`;
  return { key, wgsl };
}
