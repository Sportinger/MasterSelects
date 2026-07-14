export type LightKind = 'point' | 'panel' | 'environment';

export interface LightClipSettings {
  kind: LightKind;
  color: string;
  intensity: number;
  diameter: number;
  castsShadows: boolean;
  shadowStrength: number;
  environmentMapMediaFileId?: string;
  environmentMapUrl?: string;
  environmentMapFileName?: string;
}

export const DEFAULT_LIGHT_CLIP_SETTINGS: LightClipSettings = {
  kind: 'point',
  color: '#ffffff',
  intensity: 1,
  diameter: 2,
  castsShadows: false,
  shadowStrength: 0.5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value: string | undefined): string {
  const input = value?.trim() ?? '';
  const short = /^#?([0-9a-f]{3})$/i.exec(input);
  if (short) {
    return `#${short[1].split('').map((char) => `${char}${char}`).join('').toLowerCase()}`;
  }
  const full = /^#?([0-9a-f]{6})$/i.exec(input);
  return full ? `#${full[1].toLowerCase()}` : DEFAULT_LIGHT_CLIP_SETTINGS.color;
}

export function hexToRgb01(value: string): [number, number, number] {
  const hex = normalizeHexColor(value).slice(1);
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

export function rgb01ToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(clamp(channel, 0, 1) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function mergeLightClipSettings(input?: Partial<LightClipSettings>): LightClipSettings {
  return {
    kind: input?.kind === 'panel' || input?.kind === 'environment' ? input.kind : 'point',
    color: normalizeHexColor(input?.color),
    intensity: Math.max(0, input?.intensity ?? DEFAULT_LIGHT_CLIP_SETTINGS.intensity),
    diameter: Math.max(0.01, input?.diameter ?? DEFAULT_LIGHT_CLIP_SETTINGS.diameter),
    castsShadows: input?.castsShadows ?? DEFAULT_LIGHT_CLIP_SETTINGS.castsShadows,
    shadowStrength: clamp(input?.shadowStrength ?? DEFAULT_LIGHT_CLIP_SETTINGS.shadowStrength, 0, 1),
    ...(input?.environmentMapMediaFileId ? { environmentMapMediaFileId: input.environmentMapMediaFileId } : {}),
    ...(input?.environmentMapUrl ? { environmentMapUrl: input.environmentMapUrl } : {}),
    ...(input?.environmentMapFileName ? { environmentMapFileName: input.environmentMapFileName } : {}),
  };
}

export type LightPropertyName = 'intensity' | 'diameter' | 'shadowStrength' | 'color.r' | 'color.g' | 'color.b';
export type LightProperty = `light.${LightPropertyName}`;

export function isLightProperty(property: string): property is LightProperty {
  return /^light\.(intensity|diameter|shadowStrength|color\.(r|g|b))$/.test(property);
}

export function parseLightProperty(property: string): LightPropertyName | null {
  return isLightProperty(property) ? property.slice('light.'.length) as LightPropertyName : null;
}

export function setLightSettingValue(
  settings: LightClipSettings,
  property: LightPropertyName,
  value: number,
): LightClipSettings {
  if (property === 'intensity') {
    return mergeLightClipSettings({ ...settings, intensity: value });
  }
  if (property === 'diameter') {
    return mergeLightClipSettings({ ...settings, diameter: value });
  }
  if (property === 'shadowStrength') {
    return mergeLightClipSettings({ ...settings, shadowStrength: value });
  }

  const [r, g, b] = hexToRgb01(settings.color);
  return mergeLightClipSettings({
    ...settings,
    color: rgb01ToHex(
      property === 'color.r' ? value : r,
      property === 'color.g' ? value : g,
      property === 'color.b' ? value : b,
    ),
  });
}
