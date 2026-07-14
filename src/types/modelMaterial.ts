export type ModelMaterialShading = 'asset' | 'lit' | 'unlit';

export interface ModelMaterialSettings {
  overrideBaseColor: boolean;
  baseColor: string;
  useEmbeddedTexture: boolean;
  shading: ModelMaterialShading;
  uvScaleX: number;
  uvScaleY: number;
  uvOffsetX: number;
  uvOffsetY: number;
}

export const DEFAULT_MODEL_MATERIAL_SETTINGS: ModelMaterialSettings = {
  overrideBaseColor: false,
  baseColor: '#888888',
  useEmbeddedTexture: true,
  shading: 'asset',
  uvScaleX: 1,
  uvScaleY: 1,
  uvOffsetX: 0,
  uvOffsetY: 0,
};

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

export function mergeModelMaterialSettings(input?: Partial<ModelMaterialSettings>): ModelMaterialSettings {
  return {
    overrideBaseColor: input?.overrideBaseColor ?? DEFAULT_MODEL_MATERIAL_SETTINGS.overrideBaseColor,
    baseColor: normalizeModelMaterialColor(input?.baseColor),
    useEmbeddedTexture: input?.useEmbeddedTexture ?? DEFAULT_MODEL_MATERIAL_SETTINGS.useEmbeddedTexture,
    shading: input?.shading === 'lit' || input?.shading === 'unlit' ? input.shading : 'asset',
    uvScaleX: finiteNumber(input?.uvScaleX, DEFAULT_MODEL_MATERIAL_SETTINGS.uvScaleX),
    uvScaleY: finiteNumber(input?.uvScaleY, DEFAULT_MODEL_MATERIAL_SETTINGS.uvScaleY),
    uvOffsetX: finiteNumber(input?.uvOffsetX, DEFAULT_MODEL_MATERIAL_SETTINGS.uvOffsetX),
    uvOffsetY: finiteNumber(input?.uvOffsetY, DEFAULT_MODEL_MATERIAL_SETTINGS.uvOffsetY),
  };
}

export function normalizeModelMaterialColor(value: string | undefined): string {
  const input = value?.trim() ?? '';
  const short = /^#?([0-9a-f]{3})$/i.exec(input);
  if (short) {
    return `#${short[1].split('').map((char) => `${char}${char}`).join('').toLowerCase()}`;
  }
  const full = /^#?([0-9a-f]{6})$/i.exec(input);
  return full ? `#${full[1].toLowerCase()}` : DEFAULT_MODEL_MATERIAL_SETTINGS.baseColor;
}
