import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorGroup, OperatorValue } from '../../types/operatorGraph';

interface Ref { node: string; port: string }
type GroupId = 'parameters' | 'aa' | 'lens' | 'edges' | 'chroma' | 'resolve';

class GraphBuilder {
  nodes: BoundOperatorNode[] = [];
  edges: OperatorEdge[] = [];
  layout: EffectOperatorGraph['layout'] = {};
  private rows = new Map<number, number>();
  private members = new Map<GroupId, string[]>();

  node(id: string, operator: string, stage: number, group: GroupId, constants?: Record<string, OperatorValue>, bindings: Record<string, string> = {}): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    const row = this.rows.get(stage) ?? 0; this.rows.set(stage, row + 1);
    this.layout[id] = { x: stage * 300, y: row * 180 };
    this.members.set(group, [...(this.members.get(group) ?? []), id]);
    return { node: id, port: operator === 'image.frame' ? 'image' : operator === 'image.normalized-uv' ? 'uv'
      : operator === 'vector.split.rgba' ? 'image' : operator === 'vector.combine.rgba' ? 'image'
        : operator === 'convert.scalar-to-rgb' ? 'rgb' : operator === 'convert.vec4-to-image' ? 'image' : 'value' };
  }

  connect(from: Ref, to: Ref, input: string) {
    this.edges.push({ id: `${from.node}-${to.node}-${input}-${this.edges.length}`, from: from.node, output: from.port, to: to.node, input });
  }

  unary(id: string, operator: string, value: Ref, stage: number, group: GroupId, input = 'value') {
    const result = this.node(id, operator, stage, group); this.connect(value, result, input); return result;
  }

  binary(id: string, operator: string, a: Ref, b: Ref, stage: number, group: GroupId) {
    const result = this.node(id, operator, stage, group); this.connect(a, result, 'a'); this.connect(b, result, 'b'); return result;
  }

  scalar(id: string, value: number, stage = 0, group: GroupId = 'parameters') {
    return this.node(id, 'values.number', stage, group, { value });
  }

  bound(id: string, parameter = id) { return this.node(id, 'values.number', 0, 'parameters', undefined, { value: parameter }); }
  choice(id: string, parameter = id) { return this.node(id, 'values.choice', 0, 'parameters', undefined, { value: parameter }); }
  boolean(id: string, parameter = id) { return this.node(id, 'values.boolean', 0, 'parameters', undefined, { value: parameter }); }

  vec2(id: string, x: Ref, y: Ref, stage: number, group: GroupId) {
    const result = this.node(id, 'vector.combine.vec2', stage, group); this.connect(x, result, 'x'); this.connect(y, result, 'y'); return result;
  }

  selectScalar(id: string, condition: Ref, falseValue: Ref, trueValue: Ref, stage: number, group: GroupId) {
    const result = this.node(id, 'select.scalar', stage, group); this.connect(falseValue, result, 'falseValue');
    this.connect(trueValue, result, 'trueValue'); this.connect(condition, result, 'condition'); return result;
  }

  selectLazyScalar(id: string, condition: Ref, falseValue: Ref, trueValue: Ref, stage: number, group: GroupId) {
    const result = this.node(id, 'control.select.scalar', stage, group); this.connect(falseValue, result, 'falseValue');
    this.connect(trueValue, result, 'trueValue'); this.connect(condition, result, 'condition'); return result;
  }

  selectVec2(id: string, condition: Ref, falseValue: Ref, trueValue: Ref, stage: number, group: GroupId) {
    const result = this.node(id, 'select.vec2', stage, group); this.connect(falseValue, result, 'falseValue');
    this.connect(trueValue, result, 'trueValue'); this.connect(condition, result, 'condition'); return result;
  }

  selectImage(id: string, condition: Ref, falseValue: Ref, trueValue: Ref, stage: number, group: GroupId) {
    const result = this.node(id, 'control.select.image', stage, group); this.connect(falseValue, result, 'falseValue');
    this.connect(trueValue, result, 'trueValue'); this.connect(condition, result, 'condition'); return { node: result.node, port: 'image' };
  }

  groups(): OperatorGroup[] {
    const labels: Record<GroupId, string> = { parameters: 'Fisheye Parameters', aa: 'Edge Sampling', lens: 'Lens Projection',
      edges: 'Frame Edges', chroma: 'Chromatic Aberration', resolve: 'Lens Resolve' };
    return (Object.keys(labels) as GroupId[]).map((id, index) => ({ id: `fisheye-${id}`, label: labels[id],
      color: ['#64748b', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981'][index], nodeIds: this.members.get(id) ?? [] }));
  }
}

export function createDefaultFisheyeGraph(): EffectOperatorGraph {
  const g = new GraphBuilder(), frame = g.node('frame', 'image.frame', 0, 'parameters'), uv = g.node('uv', 'image.normalized-uv', 1, 'aa');
  const resolution = g.node('resolution', 'image.resolution', 0, 'parameters'), resolutionSplit = g.unary('resolution-split', 'vector.split.vec2', resolution, 1, 'parameters');
  const width = { node: resolutionSplit.node, port: 'x' }, height = { node: resolutionSplit.node, port: 'y' };
  const zero = g.scalar('zero', 0), one = g.scalar('one', 1), half = g.scalar('half', .5), epsilon = g.scalar('epsilon', .0001);
  const tiny = g.scalar('tiny', .000001), edgeTiny = g.scalar('edge-tiny', .00001), three = g.scalar('three', 3);
  const centerX = g.bound('center-x', 'centerX'), centerY = g.bound('center-y', 'centerY'), center = g.vec2('center', centerX, centerY, 1, 'lens');
  const strength = g.bound('strength'), fovDegrees = g.bound('field-of-view', 'fieldOfView'), radiusParam = g.bound('lens-radius', 'radius');
  const zoom = g.bound('zoom'), squeeze = g.bound('squeeze'), rotationDegrees = g.bound('rotation');
  const curveBias = g.bound('curve-bias', 'curveBias'), feather = g.bound('feather'), edgeFeather = g.bound('edge-feather', 'edgeFeather');
  const aberration = g.bound('chromatic-aberration', 'chromaticAberration'), vignette = g.bound('vignette');
  const vignetteSoftness = g.bound('vignette-softness', 'vignetteSoftness'), samples = g.bound('samples');
  const projection = g.choice('projection'), edgeMode = g.choice('edge-mode', 'edgeMode'), outsideMode = g.choice('outside-mode', 'outside');
  const preserveAspect = g.boolean('preserve-aspect', 'preserveAspect');
  const fov = g.unary('field-of-view-radians', 'convert.degrees-to-radians.scalar', fovDegrees, 1, 'lens');
  const rotation = g.unary('rotation-radians', 'convert.degrees-to-radians.scalar', rotationDegrees, 1, 'lens');
  const aspect = g.binary('frame-aspect', 'math.divide-ieee.scalar', width, height, 1, 'lens');

  // Fixed eight-position AA pattern, selected from the lexical sequence index.
  const sequence = g.node('aa-sequence', 'image.sequence-index', 2, 'aa'), sequenceIndex = { node: sequence.node, port: 'index' };
  const offsets = [[-.375, -.125], [.125, -.375], [.375, .125], [-.125, .375], [-.4375, .3125], [-.3125, -.4375], [.4375, -.3125], [.3125, .4375]]
    .map(([x, y], index) => g.vec2(`jitter-${index}`, g.scalar(`jitter-${index}-x`, x, 1, 'aa'), g.scalar(`jitter-${index}-y`, y, 1, 'aa'), 2, 'aa'));
  let jitter = offsets[7];
  for (let index = 6; index >= 0; index--) {
    const threshold = g.scalar(`jitter-threshold-${index}`, index + .5, 1, 'aa');
    const before = g.binary(`jitter-before-${index}`, 'compare.greater.scalar', threshold, sequenceIndex, 2, 'aa'); before.port = 'condition';
    jitter = g.selectVec2(`jitter-select-${index}`, before, jitter, offsets[index], 3, 'aa');
  }
  const moreThanOne = g.binary('aa-enabled', 'compare.greater.scalar', samples, one, 2, 'aa'); moreThanOne.port = 'condition';
  const zeroVec = g.unary('zero-vector', 'convert.scalar-to-vec2', zero, 2, 'aa');
  jitter = g.selectVec2('jitter-or-zero', moreThanOne, zeroVec, jitter, 3, 'aa');
  const oneVec = g.unary('one-vector', 'convert.scalar-to-vec2', one, 2, 'aa');
  const texelSize = g.binary('texel-size', 'math.divide-ieee.vec2', oneVec, resolution, 3, 'aa');
  const jitterUv = g.binary('jitter-texel', 'math.multiply.vec2', jitter, texelSize, 4, 'aa');
  const outputUv = g.binary('sample-uv', 'math.add.vec2', uv, jitterUv, 5, 'aa');

  // Output UV to normalized lens space.
  const delta = g.binary('centered-uv', 'math.subtract.vec2', outputUv, center, 6, 'lens');
  const aspectScale = g.vec2('aspect-scale', aspect, one, 6, 'lens'), aspectDelta = g.binary('aspect-delta', 'math.multiply.vec2', delta, aspectScale, 7, 'lens');
  const preservedDelta = g.selectVec2('aspect-select', preserveAspect, delta, aspectDelta, 8, 'lens');
  const negativeRotation = g.binary('negative-rotation', 'math.subtract.scalar', zero, rotation, 7, 'lens');
  const rotated = g.node('lens-rotate-in', 'coordinates.rotate.vec2', 9, 'lens');
  g.connect(preservedDelta, rotated, 'value'); g.connect(negativeRotation, rotated, 'angle');
  const squeezeScale = g.vec2('squeeze-scale', squeeze, one, 8, 'lens'), squeezed = g.binary('squeezed', 'math.multiply.vec2', rotated, squeezeScale, 10, 'lens');
  const radiusHalf = g.binary('radius-half', 'math.multiply.scalar', radiusParam, half, 7, 'lens');
  const radiusHalfSafe = g.binary('radius-half-safe', 'math.max.scalar', radiusHalf, epsilon, 8, 'lens');
  const lensPosition = g.binary('lens-position', 'math.divide-ieee.vec2-scalar', squeezed, radiusHalfSafe, 11, 'lens');
  const lensRadius = g.unary('lens-position-radius', 'vector.length.vec2', lensPosition, 12, 'lens');
  const safeRadius = g.binary('safe-radius', 'math.max.scalar', lensRadius, tiny, 12, 'lens');
  const direction = g.binary('lens-direction', 'math.divide-ieee.vec2-scalar', lensPosition, safeRadius, 13, 'lens');

  // Four physical projection models with generic visible strength/bias/zoom math.
  const fovHalf = g.binary('fov-half', 'math.multiply.scalar', fov, half, 4, 'lens'), fovMin = g.scalar('fov-min', .01);
  const pi = g.scalar('pi', Math.PI), projectionLimit = g.scalar('projection-limit', .4861);
  const fovMax = g.binary('fov-max', 'math.multiply.scalar', pi, projectionLimit, 4, 'lens');
  const maxTheta = g.node('max-theta', 'math.clamp.scalar', 5, 'lens'); g.connect(fovHalf, maxTheta, 'value'); g.connect(fovMin, maxTheta, 'min'); g.connect(fovMax, maxTheta, 'max');
  const tanMaximum = g.unary('tan-max-theta', 'math.tan.scalar', maxTheta, 6, 'lens');
  const rectilinearScale = g.binary('rectilinear-scale', 'math.max.scalar', tanMaximum, epsilon, 7, 'lens');
  const positiveTheta = g.node('unproject-radius', 'optics.unproject-radius.scalar', 14, 'lens');
  g.connect(lensRadius, positiveTheta, 'radius'); g.connect(maxTheta, positiveTheta, 'maxTheta'); g.connect(projection, positiveTheta, 'model');
  const positiveTan = g.unary('unproject-tangent', 'math.tan.scalar', positiveTheta, 15, 'lens');
  const positiveTarget = g.binary('positive-target-radius', 'math.divide-ieee.scalar', positiveTan, rectilinearScale, 16, 'lens');
  const negativeScaled = g.binary('negative-scaled-radius', 'math.multiply.scalar', lensRadius, rectilinearScale, 14, 'lens');
  const negativeTheta = g.unary('negative-theta', 'math.atan.scalar', negativeScaled, 15, 'lens');
  const negativeTarget = g.node('project-radius', 'optics.project-radius.scalar', 16, 'lens');
  g.connect(negativeTheta, negativeTarget, 'theta'); g.connect(maxTheta, negativeTarget, 'maxTheta'); g.connect(projection, negativeTarget, 'model');
  const isNegative = g.binary('strength-negative', 'compare.greater.scalar', zero, strength, 14, 'lens'); isNegative.port = 'condition';
  let targetRadius = g.selectLazyScalar('projection-direction', isNegative, positiveTarget, negativeTarget, 17, 'lens');
  const radiusSquared = g.binary('radius-squared', 'math.multiply.scalar', lensRadius, lensRadius, 14, 'lens');
  const radiusCubed = g.binary('radius-cubed', 'math.multiply.scalar', radiusSquared, lensRadius, 15, 'lens');
  const cubicDelta = g.binary('cubic-delta', 'math.subtract.scalar', radiusCubed, lensRadius, 16, 'lens');
  const curveScale = g.scalar('curve-scale', .35), curve = g.binary('curve-delta', 'math.multiply.scalar', cubicDelta, curveScale, 17, 'lens');
  const minusOne = g.scalar('minus-one', -1), directionSign = g.selectScalar('strength-direction', isNegative, one, minusOne, 17, 'lens');
  const biasDirection = g.binary('bias-direction', 'math.multiply.scalar', curveBias, directionSign, 18, 'lens');
  const biasedCurve = g.binary('biased-curve', 'math.multiply.scalar', biasDirection, curve, 19, 'lens');
  targetRadius = g.binary('biased-target', 'math.add.scalar', targetRadius, biasedCurve, 20, 'lens');
  targetRadius = g.binary('nonnegative-target', 'math.max.scalar', targetRadius, zero, 21, 'lens');
  const absoluteStrength = g.unary('absolute-strength', 'math.abs.scalar', strength, 18, 'lens');
  const mixedRadius = g.node('mixed-radius', 'math.mix.scalar', 22, 'lens'); g.connect(lensRadius, mixedRadius, 'a'); g.connect(targetRadius, mixedRadius, 'b'); g.connect(absoluteStrength, mixedRadius, 't');
  const safeZoom = g.binary('safe-zoom', 'math.max.scalar', zoom, epsilon, 18, 'lens');
  const sampleRadius = g.binary('sample-radius', 'math.divide-ieee.scalar', mixedRadius, safeZoom, 23, 'lens');

  const lensToUv = (id: string, inputPoint: Ref, stage: number) => {
    let point = inputPoint;
    point = g.binary(`${id}-radius-scale`, 'math.multiply.vec2-scalar', point, radiusHalfSafe, stage + 1, 'chroma');
    const split = g.unary(`${id}-split`, 'vector.split.vec2', point, stage + 2, 'chroma');
    const x = g.binary(`${id}-unsqueeze-x`, 'math.divide-ieee.scalar', { node: split.node, port: 'x' }, g.binary(`${id}-safe-squeeze`, 'math.max.scalar', squeeze, epsilon, stage + 1, 'chroma'), stage + 2, 'chroma');
    point = g.vec2(`${id}-unsqueezed`, x, { node: split.node, port: 'y' }, stage + 3, 'chroma');
    const rotatedOut = g.node(`${id}-rotate-out`, 'coordinates.rotate.vec2', stage + 4, 'chroma');
    g.connect(point, rotatedOut, 'value'); g.connect(rotation, rotatedOut, 'angle'); point = rotatedOut;
    const rotatedSplit = g.unary(`${id}-rotated-split`, 'vector.split.vec2', point, stage + 5, 'chroma');
    const safeAspect = g.binary(`${id}-safe-aspect`, 'math.max.scalar', aspect, epsilon, stage + 4, 'chroma');
    const aspectX = g.binary(`${id}-aspect-x`, 'math.divide-ieee.scalar', { node: rotatedSplit.node, port: 'x' }, safeAspect, stage + 5, 'chroma');
    const corrected = g.vec2(`${id}-aspect-corrected`, aspectX, { node: rotatedSplit.node, port: 'y' }, stage + 6, 'chroma');
    point = g.selectVec2(`${id}-aspect-select`, preserveAspect, point, corrected, stage + 7, 'chroma');
    return g.binary(`${id}-uv`, 'math.add.vec2', center, point, stage + 8, 'chroma');
  };

  // One shared scoped edge sampler; every chroma UV re-evaluates this expression at its own raw coordinate.
  const edgeUv = g.node('edge-uv', 'image.normalized-uv', 24, 'edges');
  const zeroVector = g.unary('edge-zero-vector', 'convert.scalar-to-vec2', zero, 24, 'edges'), edgeOneVector = g.unary('edge-one-vector', 'convert.scalar-to-vec2', one, 24, 'edges');
  const clampedUv = g.node('edge-clamped-uv', 'math.clamp.vec2', 25, 'edges'); g.connect(edgeUv, clampedUv, 'value'); g.connect(zeroVector, clampedUv, 'min'); g.connect(edgeOneVector, clampedUv, 'max');
  const mirroredUv = g.unary('edge-mirrored-uv', 'coordinates.mirror-repeat.vec2', edgeUv, 25, 'edges');
  const repeatedUv = g.unary('edge-repeated-uv', 'math.fract.vec2', edgeUv, 25, 'edges');
  const modeMirror = g.scalar('edge-mode-mirror-threshold', 1.5), modeRepeat = g.scalar('edge-mode-repeat-threshold', 2.5);
  const aboveMirror = g.binary('edge-above-mirror', 'compare.greater.scalar', edgeMode, modeMirror, 25, 'edges'); aboveMirror.port = 'condition';
  const aboveRepeat = g.binary('edge-above-repeat', 'compare.greater.scalar', edgeMode, modeRepeat, 25, 'edges'); aboveRepeat.port = 'condition';
  const mirrorOrRepeat = g.selectVec2('edge-mirror-or-repeat', aboveRepeat, mirroredUv, repeatedUv, 26, 'edges');
  const adjustedUv = g.selectVec2('edge-adjusted-uv', aboveMirror, clampedUv, mirrorOrRepeat, 27, 'edges');
  const edgeColor = g.node('edge-color', 'image.sample', 28, 'edges'); g.connect(frame, edgeColor, 'image'); g.connect(adjustedUv, edgeColor, 'uv'); edgeColor.port = 'image';
  const edgeSplit = g.unary('edge-uv-split', 'vector.split.vec2', edgeUv, 25, 'edges');
  const edgeX = { node: edgeSplit.node, port: 'x' }, edgeY = { node: edgeSplit.node, port: 'y' };
  const oneMinusX = g.binary('edge-one-minus-x', 'math.subtract.scalar', one, edgeX, 26, 'edges');
  const oneMinusY = g.binary('edge-one-minus-y', 'math.subtract.scalar', one, edgeY, 26, 'edges');
  const minXY = g.binary('edge-min-xy', 'math.min.scalar', edgeX, edgeY, 27, 'edges');
  const minInverse = g.binary('edge-min-inverse', 'math.min.scalar', oneMinusX, oneMinusY, 27, 'edges');
  const insideDistance = g.binary('edge-inside-distance', 'math.min.scalar', minXY, minInverse, 28, 'edges');
  const hardEdge = g.node('edge-hard-coverage', 'math.step.scalar', 29, 'edges'); g.connect(zero, hardEdge, 'edge'); g.connect(insideDistance, hardEdge, 'value');
  const softEdge = g.node('edge-soft-coverage', 'math.smoothstep.scalar', 29, 'edges'); g.connect(zero, softEdge, 'edge0'); g.connect(edgeFeather, softEdge, 'edge1'); g.connect(insideDistance, softEdge, 'value');
  const hardEdgeImage = g.binary('edge-hard-image', 'math.multiply.image-scalar', edgeColor, hardEdge, 30, 'edges'); hardEdgeImage.port = 'value';
  const softEdgeImage = g.binary('edge-soft-image', 'math.multiply.image-scalar', edgeColor, softEdge, 30, 'edges'); softEdgeImage.port = 'value';
  const edgeFeatherEnabled = g.binary('edge-feather-enabled', 'compare.greater.scalar', edgeFeather, edgeTiny, 29, 'edges'); edgeFeatherEnabled.port = 'condition';
  const coveredEdge = g.selectImage('edge-feather-select', edgeFeatherEnabled, hardEdgeImage, softEdgeImage, 31, 'edges');
  const nonTransparentMode = g.binary('edge-mode-nontransparent', 'compare.greater.scalar', edgeMode, zero, 29, 'edges'); nonTransparentMode.port = 'condition';
  const edgeExpression = g.selectImage('edge-mode-select', nonTransparentMode, coveredEdge, edgeColor, 32, 'edges');

  const sampleAt = (id: string, coordinate: Ref, stage: number) => {
    const sample = g.node(id, 'image.sample', stage, 'chroma'); g.connect(edgeExpression, sample, 'image'); g.connect(coordinate, sample, 'uv'); return { node: sample.node, port: 'image' };
  };
  const greenPoint = g.binary('green-point', 'math.multiply.vec2-scalar', direction, sampleRadius, 24, 'chroma');
  const baseUv = lensToUv('green', greenPoint, 25), greenSample = sampleAt('green-sample', baseUv, 34);
  const chromaTimesRadius = g.binary('chroma-times-radius', 'math.multiply.scalar', aberration, lensRadius, 23, 'chroma');
  const chromaShift = g.binary('chroma-shift', 'math.multiply.scalar', chromaTimesRadius, lensRadius, 24, 'chroma');
  const onePlusShift = g.binary('one-plus-chroma', 'math.add.scalar', one, chromaShift, 25, 'chroma');
  const oneMinusShift = g.binary('one-minus-chroma', 'math.subtract.scalar', one, chromaShift, 25, 'chroma');
  const redPoint = g.binary('red-point', 'math.multiply.vec2-scalar', greenPoint, onePlusShift, 26, 'chroma');
  const bluePoint = g.binary('blue-point', 'math.multiply.vec2-scalar', greenPoint, oneMinusShift, 26, 'chroma');
  const redSample = sampleAt('red-sample', lensToUv('red', redPoint, 27), 37), blueSample = sampleAt('blue-sample', lensToUv('blue', bluePoint, 27), 37);
  const redVec = g.unary('red-rgba', 'convert.image-to-vec4', redSample, 38, 'chroma', 'image');
  const greenVec = g.unary('green-rgba', 'convert.image-to-vec4', greenSample, 38, 'chroma', 'image');
  const blueVec = g.unary('blue-rgba', 'convert.image-to-vec4', blueSample, 38, 'chroma', 'image');
  const redSplit = g.unary('red-channel-split', 'vector.split.vec4', redVec, 39, 'chroma');
  const greenSplit = g.unary('green-channel-split', 'vector.split.vec4', greenVec, 39, 'chroma');
  const blueSplit = g.unary('blue-channel-split', 'vector.split.vec4', blueVec, 39, 'chroma');
  const alphaRG = g.binary('alpha-red-green', 'math.add.scalar', { node: redSplit.node, port: 'w' }, { node: greenSplit.node, port: 'w' }, 40, 'chroma');
  const alphaSum = g.binary('alpha-sum', 'math.add.scalar', alphaRG, { node: blueSplit.node, port: 'w' }, 41, 'chroma');
  const averageAlpha = g.binary('alpha-average', 'math.divide-ieee.scalar', alphaSum, three, 42, 'chroma');
  const separated = g.node('chroma-rgba', 'vector.combine.vec4', 42, 'chroma');
  g.connect({ node: redSplit.node, port: 'x' }, separated, 'x'); g.connect({ node: greenSplit.node, port: 'y' }, separated, 'y');
  g.connect({ node: blueSplit.node, port: 'z' }, separated, 'z'); g.connect(averageAlpha, separated, 'w');
  const separatedImage = g.unary('chroma-image', 'convert.vec4-to-image', separated, 43, 'chroma');
  const chromaEnabled = g.binary('chroma-enabled', 'compare.greater.scalar', aberration, tiny, 42, 'chroma'); chromaEnabled.port = 'condition';
  let lensColor = g.selectImage('chroma-select', chromaEnabled, greenSample, separatedImage, 44, 'chroma');

  // Vignette preserves alpha, then lens coverage mixes with selected outside color.
  const vignetteStartRaw = g.binary('vignette-start-raw', 'math.subtract.scalar', one, vignetteSoftness, 36, 'resolve');
  const vignetteStart = g.binary('vignette-start', 'math.max.scalar', zero, vignetteStartRaw, 37, 'resolve');
  const vignetteMask = g.node('vignette-mask', 'math.smoothstep.scalar', 38, 'resolve'); g.connect(vignetteStart, vignetteMask, 'edge0'); g.connect(one, vignetteMask, 'edge1'); g.connect(lensRadius, vignetteMask, 'value');
  const vignetteAmount = g.binary('vignette-amount', 'math.multiply.scalar', vignette, vignetteMask, 39, 'resolve');
  const vignetteFactor = g.binary('vignette-factor', 'math.subtract.scalar', one, vignetteAmount, 40, 'resolve');
  const lensSplit = g.node('lens-split', 'vector.split.rgba', 45, 'resolve'); g.connect(lensColor, lensSplit, 'image');
  const darkenedRgb = g.binary('vignette-rgb', 'math.multiply.rgb-scalar', { node: lensSplit.node, port: 'rgb' }, vignetteFactor, 46, 'resolve');
  const vignetteImage = g.node('vignette-image', 'vector.combine.rgba', 47, 'resolve'); g.connect(darkenedRgb, vignetteImage, 'rgb'); g.connect({ node: lensSplit.node, port: 'alpha' }, vignetteImage, 'alpha'); vignetteImage.port = 'image';
  lensColor = vignetteImage;
  const original = g.node('original-sample', 'image.sample', 45, 'resolve'); g.connect(frame, original, 'image'); g.connect(outputUv, original, 'uv'); original.port = 'image';
  const transparent = g.node('transparent', 'values.color', 45, 'resolve', { value: '#00000000' });
  const transparentImage = g.unary('transparent-image', 'convert.vec4-to-image', transparent, 46, 'resolve');
  const transparentOutside = g.binary('outside-transparent', 'compare.greater.scalar', outsideMode, zero, 46, 'resolve'); transparentOutside.port = 'condition';
  const outsideColor = g.selectImage('outside-select', transparentOutside, original, transparentImage, 47, 'resolve');
  const outsideVec = g.unary('outside-rgba', 'convert.image-to-vec4', outsideColor, 48, 'resolve', 'image');
  const finalLensVec = g.unary('final-lens-rgba', 'convert.image-to-vec4', lensColor, 48, 'resolve', 'image');
  const hardCoverage = g.node('lens-hard-coverage', 'math.step.scalar', 42, 'resolve'); g.connect(lensRadius, hardCoverage, 'edge'); g.connect(one, hardCoverage, 'value');
  const featherStartRaw = g.binary('lens-feather-start-raw', 'math.subtract.scalar', one, feather, 40, 'resolve');
  const featherStart = g.binary('lens-feather-start', 'math.max.scalar', zero, featherStartRaw, 41, 'resolve');
  const featherMask = g.node('lens-feather-mask', 'math.smoothstep.scalar', 42, 'resolve'); g.connect(featherStart, featherMask, 'edge0'); g.connect(one, featherMask, 'edge1'); g.connect(lensRadius, featherMask, 'value');
  const softCoverage = g.binary('lens-soft-coverage', 'math.subtract.scalar', one, featherMask, 43, 'resolve');
  const mixResolved = (id: string, coverage: Ref, stage: number) => {
    const mixed = g.node(`${id}-rgba`, 'math.mix.vec4', stage, 'resolve');
    g.connect(outsideVec, mixed, 'a'); g.connect(finalLensVec, mixed, 'b'); g.connect(coverage, mixed, 't');
    return g.unary(`${id}-image`, 'convert.vec4-to-image', mixed, stage + 1, 'resolve');
  };
  const hardResolved = mixResolved('hard-resolve', hardCoverage, 49), softResolved = mixResolved('soft-resolve', softCoverage, 49);
  const featherEnabled = g.binary('lens-feather-enabled', 'compare.greater.scalar', feather, edgeTiny, 49, 'resolve'); featherEnabled.port = 'condition';
  const renderedSample = g.selectImage('lens-feather-select', featherEnabled, hardResolved, softResolved, 51, 'resolve');

  const weight = g.scalar('aa-weight', 1, 2, 'aa'), reducer = g.node('aa-reduce', 'image.sequence-reduce', 52, 'aa');
  g.connect(renderedSample, reducer, 'sample'); g.connect(weight, reducer, 'weight'); g.connect(samples, reducer, 'count');
  const sum = { node: reducer.node, port: 'sum' }, weightSum = { node: reducer.node, port: 'weightSum' };
  const weightVector = g.unary('aa-weight-vector', 'convert.scalar-to-vec4', weightSum, 53, 'aa');
  const average = g.binary('aa-average', 'math.divide-ieee.vec4', sum, weightVector, 54, 'aa');
  const image = g.unary('fisheye-image', 'convert.vec4-to-image', average, 55, 'resolve');
  const output = g.node('output', 'image.output', 56, 'resolve'); g.connect(image, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout, groups: g.groups() };
}
