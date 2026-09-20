import type { ColorEditorParamDefinition } from './colorEditorTypes';

export interface WheelControlConfig {
  id: 'lift' | 'gamma' | 'gain' | 'offset';
  label: string;
  rKey: string;
  gKey: string;
  bKey: string;
  yKey: string;
  chromaRange: number;
}

export const WHEEL_CONTROL_CONFIGS: WheelControlConfig[] = [
  { id: 'lift', label: 'Lift', rKey: 'liftR', gKey: 'liftG', bKey: 'liftB', yKey: 'liftY', chromaRange: 0.35 },
  { id: 'gamma', label: 'Gamma', rKey: 'gammaR', gKey: 'gammaG', bKey: 'gammaB', yKey: 'gammaY', chromaRange: 0.65 },
  { id: 'gain', label: 'Gain', rKey: 'gainR', gKey: 'gainG', bKey: 'gainB', yKey: 'gainY', chromaRange: 0.65 },
  { id: 'offset', label: 'Offset', rKey: 'offsetR', gKey: 'offsetG', bKey: 'offsetB', yKey: 'offsetY', chromaRange: 0.45 },
];

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getControlSections(defs: ColorEditorParamDefinition[]) {
  const sections = new Map<string, ColorEditorParamDefinition[]>();
  for (const def of defs) {
    const sectionDefs = sections.get(def.section) ?? [];
    sectionDefs.push(def);
    sections.set(def.section, sectionDefs);
  }
  return [...sections.entries()];
}

export function getWheelParamDef(
  defs: ColorEditorParamDefinition[],
  key: string
): ColorEditorParamDefinition {
  const def = defs.find(candidate => candidate.key === key);
  if (!def) {
    throw new Error(`Missing wheel color parameter definition for ${key}`);
  }
  return def;
}

export function getWheelPuckPosition(
  config: WheelControlConfig,
  values: { r: number; g: number; b: number },
  neutral: number
): { x: number; y: number } {
  const rBias = values.r - neutral;
  const gBias = values.g - neutral;
  const bBias = values.b - neutral;
  // Resolve presents the RGB basis rotated 180 degrees: red is left,
  // blue is right, green is down, and magenta is up.
  const x = -(rBias - bBias) / (2 * config.chromaRange);
  const y = -(2 * gBias - rBias - bBias) / (3 * config.chromaRange);
  return {
    x: clampNumber(x, -1, 1),
    y: clampNumber(y, -1, 1),
  };
}

export function getWheelValuesFromPoint(
  config: WheelControlConfig,
  defs: ColorEditorParamDefinition[],
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const rDef = getWheelParamDef(defs, config.rKey);
  const gDef = getWheelParamDef(defs, config.gKey);
  const bDef = getWheelParamDef(defs, config.bKey);
  const neutral = rDef.defaultValue;
  const rgbX = -x;
  const rgbY = -y;
  return {
    r: clampNumber(neutral + rgbX * config.chromaRange - rgbY * config.chromaRange * 0.5, rDef.min, rDef.max),
    g: clampNumber(neutral + rgbY * config.chromaRange, gDef.min, gDef.max),
    b: clampNumber(neutral - rgbX * config.chromaRange - rgbY * config.chromaRange * 0.5, bDef.min, bDef.max),
  };
}

export function getWheelPoint(pad: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = pad.getBoundingClientRect();
  const rawX = ((clientX - rect.left) / rect.width - 0.5) * 2;
  const rawY = -(((clientY - rect.top) / rect.height - 0.5) * 2);
  const radius = Math.hypot(rawX, rawY);
  if (radius <= 1) {
    return { x: rawX, y: rawY };
  }
  return { x: rawX / radius, y: rawY / radius };
}
