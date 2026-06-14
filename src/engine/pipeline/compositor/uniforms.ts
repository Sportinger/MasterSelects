import { BLEND_MODE_MAP } from '../../core/types';
import type { Layer } from '../../core/types';

export const COMPOSITOR_UNIFORM_SIZE = 96;
export const COMPOSITOR_UNIFORM_FLOAT_COUNT = 24;
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
  uniformDataU32[22] = transition?.kind === 'wipe' ? 1 : 0; // transitionType: 0=none, 1=wipe
  uniformData[23] = transition?.kind === 'wipe'
    ? (transition.direction === 'right' ? -transition.progress : transition.progress)
    : 0;
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
