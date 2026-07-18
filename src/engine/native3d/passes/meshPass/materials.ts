import type { SceneNativeMeshLayer } from '../MeshPass';
import {
  DEFAULT_MESH_COLOR,
  WIREFRAME_COLOR,
} from './constants';
import { mergeModelMaterialSettings } from '../../../../types/modelMaterial';

export interface MeshMaterialPlan {
  color: readonly [number, number, number, number];
  unlit: boolean;
  textureEnabled: boolean;
  uvScaleX: number;
  uvScaleY: number;
  uvOffsetX: number;
  uvOffsetY: number;
}

export function resolveMeshLayerColor(
  layer: SceneNativeMeshLayer,
  modelBaseColor?: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  if (layer.wireframe === true) {
    return WIREFRAME_COLOR;
  }
  if (layer.kind === 'text3d') {
    return parseColor(layer.text3DProperties?.color);
  }
  if (layer.kind === 'model' && modelBaseColor) {
    return modelBaseColor;
  }
  return DEFAULT_MESH_COLOR;
}

export function resolveMeshMaterialPlan(
  layer: SceneNativeMeshLayer,
  modelBaseColor?: readonly [number, number, number, number],
  modelUnlit = false,
): MeshMaterialPlan {
  const settings = layer.kind === 'model'
    ? mergeModelMaterialSettings(layer.modelMaterialSettings)
    : mergeModelMaterialSettings();
  const color = layer.kind === 'model' && settings.overrideBaseColor
    ? parseColor(settings.baseColor)
    : resolveMeshLayerColor(layer, modelBaseColor);
  return {
    color,
    unlit: settings.shading === 'unlit' || (settings.shading === 'asset' && modelUnlit),
    textureEnabled: settings.useEmbeddedTexture,
    uvScaleX: settings.uvScaleX,
    uvScaleY: settings.uvScaleY,
    uvOffsetX: settings.uvOffsetX,
    uvOffsetY: settings.uvOffsetY,
  };
}

function parseColor(color: string | undefined): readonly [number, number, number, number] {
  if (!color) {
    return DEFAULT_MESH_COLOR;
  }

  const normalized = color.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16) / 255;
    const g = parseInt(hex[1] + hex[1], 16) / 255;
    const b = parseInt(hex[2] + hex[2], 16) / 255;
    return [r, g, b, 1];
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b, 1];
  }

  const rgbaMatch = normalized.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbaMatch[1] ?? 255))) / 255;
    const g = Math.max(0, Math.min(255, Number(rgbaMatch[2] ?? 255))) / 255;
    const b = Math.max(0, Math.min(255, Number(rgbaMatch[3] ?? 255))) / 255;
    const a = Math.max(0, Math.min(1, Number(rgbaMatch[4] ?? 1)));
    return [r, g, b, a];
  }

  return DEFAULT_MESH_COLOR;
}
