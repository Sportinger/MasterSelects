import { BLEND_MODE_MAP } from '../../core/types';
import type { Layer } from '../../core/types';

export const COMPOSITOR_UNIFORM_SIZE = 116;
export const COMPOSITOR_UNIFORM_FLOAT_COUNT = 29;
export const COMPOSITOR_U32_INDICES: readonly number[] = [1, 10, 11, 16, 21, 22]; // blendMode, mask flags, inlineInvert, transitionType

export interface InlineEffectParams {
  brightness: number;  // Offset: 0 = no change, -1..1 range
  contrast: number;    // Multiplier: 1 = no change, 0..3 range
  saturation: number;  // Multiplier: 1 = no change, 0..3 range
  invert: boolean;     // Toggle: false = no invert
}

export interface UniformValueSnapshot {
  float: Float32Array;
  u32: Uint32Array;
}

function getTransitionType(layer: Layer): number {
  const transition = layer.transitionRender;
  if (!transition) return 0;

  if (transition.kind === 'wipe') {
    if (transition.direction === 'left') return 1;
    if (transition.direction === 'right') return 2;
    if (transition.direction === 'up') return 3;
    return 4;
  }
  if (transition.kind === 'soft-wipe') {
    if (transition.direction === 'right') return 27;
    if (transition.direction === 'left') return 28;
    if (transition.direction === 'down') return 29;
    return 30;
  }

  if (transition.kind === 'shape-mask') {
    if (transition.shape === 'circle') return 5;
    if (transition.shape === 'diamond') return 6;
    if (transition.shape === 'rect') return 7;
    if (transition.shape === 'oval') return 16;
    if (transition.shape === 'triangle') return 17;
    if (transition.shape === 'cross') return 18;
    return 19;
  }

  if (transition.kind === 'clock-mask') return 8;
  if (transition.kind === 'center-mask') return transition.axis === 'x' ? 9 : 10;
  if (transition.kind === 'procedural-mask') {
    if (transition.procedural === 'noise') return 11;
    if (transition.procedural === 'blocks') return 12;
  }
  if (transition.kind === 'pattern-mask') {
    if (transition.pattern === 'checker') return 13;
    if (transition.pattern === 'venetian-horizontal') return 14;
    if (transition.pattern === 'venetian-vertical') return 15;
    if (transition.pattern === 'random-blocks') return 20;
    if (transition.pattern === 'zig-zag') return 21;
    if (transition.pattern === 'polka-dot') return 22;
    if (transition.pattern === 'doom-bars') return 23;
    if (transition.pattern === 'paint-splatter') return 24;
  }
  if (transition.kind === 'distortion') {
    if (transition.distortion === 'water-drop') return 25;
    if (transition.distortion === 'swirl') return 26;
  }

  return 0;
}

export function writeLayerUniformData(
  layer: Layer,
  sourceAspect: number,
  outputAspect: number,
  hasMask: boolean,
  uniformData: Float32Array,
  uniformDataU32: Uint32Array,
  inlineEffects?: InlineEffectParams,
): void {
  // Get rotation values (layer.rotation can be number or {x,y,z} object)
  let rotX = 0, rotY = 0, rotZ = 0;
  if (typeof layer.rotation === 'number') {
    rotZ = layer.rotation;
  } else if (layer.rotation && typeof layer.rotation === 'object') {
    rotX = (layer.rotation as { x?: number; y?: number; z?: number }).x || 0;
    rotY = (layer.rotation as { x?: number; y?: number; z?: number }).y || 0;
    rotZ = (layer.rotation as { x?: number; y?: number; z?: number }).z || 0;
  }

  // Update uniforms
  uniformData[0] = layer.opacity;
  uniformDataU32[1] = BLEND_MODE_MAP[layer.blendMode]; // blendMode is u32 in shader
  uniformData[2] = layer.position.x;
  uniformData[3] = layer.position.y;
  uniformData[4] = layer.scale.x;
  uniformData[5] = layer.scale.y;
  uniformData[6] = rotZ;         // rotationZ
  uniformData[7] = sourceAspect;
  uniformData[8] = outputAspect;
  uniformData[9] = 0;  // time (for dissolve effects)
  uniformDataU32[10] = hasMask ? 1 : 0;  // hasMask
  uniformDataU32[11] = layer.maskInvert ? 1 : 0; // maskInvert (now handled in shader)
  uniformData[12] = rotX;        // rotationX
  uniformData[13] = rotY;        // rotationY
  uniformData[14] = 2.0;         // perspective distance (lower = stronger 3D effect)
  uniformData[15] = layer.maskFeather || 0;      // maskFeather (blur radius in pixels)
  uniformDataU32[16] = layer.maskFeatherQuality || 0; // maskFeatherQuality (0=low, 1=med, 2=high)
  uniformData[17] = layer.position.z ?? 0;       // posZ (depth position)
  uniformData[18] = inlineEffects?.brightness ?? 0;   // inlineBrightness (0 = no change)
  uniformData[19] = inlineEffects?.contrast ?? 1;     // inlineContrast (1 = no change)
  uniformData[20] = inlineEffects?.saturation ?? 1;   // inlineSaturation (1 = no change)
  uniformDataU32[21] = inlineEffects?.invert ? 1 : 0; // inlineInvert (0 or 1)
  const transition = layer.transitionRender;
  uniformDataU32[22] = getTransitionType(layer); // transitionType: 0=none, 1-4=wipe, 5-7/16-19=iris, 8=clock, 9-10=center, 11=noise, 12=blocks, 13=checker, 14-15/20-24=pattern, 25-26=distortion, 27-30=soft wipe
  uniformData[23] = transition?.progress ?? 0;
  uniformData[24] = transition?.kind === 'soft-wipe'
    ? transition.angle
    : transition?.kind === 'procedural-mask' || transition?.kind === 'distortion'
    ? transition.seed ?? 0
    : 0;
  uniformData[25] = layer.sourceRect?.x ?? 0;
  uniformData[26] = layer.sourceRect?.y ?? 0;
  uniformData[27] = layer.sourceRect?.width ?? 1;
  uniformData[28] = layer.sourceRect?.height ?? 1;
}

export function shouldUpdateLayerUniforms(
  uniformData: Float32Array,
  uniformDataU32: Uint32Array,
  lastValuesEntry: UniformValueSnapshot | undefined,
): boolean {
  if (!lastValuesEntry) {
    return true;
  }

  const lastFloat = lastValuesEntry.float;
  const lastU32 = lastValuesEntry.u32;

  // Check float values
  for (let i = 0; i < COMPOSITOR_UNIFORM_FLOAT_COUNT; i++) {
    // Skip indices that are u32 - compare them separately
    if (COMPOSITOR_U32_INDICES.includes(i)) continue;
    if (Math.abs(uniformData[i] - lastFloat[i]) > 0.00001) {
      return true;
    }
  }

  // Check u32 values (blendMode, hasMask, maskInvert, maskFeatherQuality, inlineInvert)
  for (const i of COMPOSITOR_U32_INDICES) {
    if (uniformDataU32[i] !== lastU32[i]) {
      return true;
    }
  }

  return false;
}
