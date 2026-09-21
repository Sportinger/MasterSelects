import type { TextClipProperties } from '../../types/text';
export type { TextNodeStage } from '../../types/text';
import type { TextNodeStage } from '../../types/text';

/** Shared field ownership for text inspectors, graph ports and reusable settings. */
export const TEXT_NODE_STAGES = {
  content: { label: 'Text Content', fields: ['text'] },
  typography: { label: 'Typography', fields: ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing'] },
  layout: { label: 'Text Layout', fields: ['textAlign', 'verticalAlign', 'boxEnabled', 'boxX', 'boxY', 'boxWidth', 'boxHeight', 'wrapMode', 'textBounds', 'pathEnabled', 'pathPoints'] },
  fill: { label: 'Fill', fields: ['color'] },
  stroke: { label: 'Stroke', fields: ['strokeEnabled', 'strokeColor', 'strokeWidth'] },
  shadow: { label: 'Shadow', fields: ['shadowEnabled', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur'] },
  render: { label: 'Text Render', fields: [] },
} as const satisfies Record<string, { label: string; fields: readonly (keyof TextClipProperties)[] }>;

export type TextSettingsStage = Exclude<TextNodeStage, 'content' | 'render'> | 'all';

export function textStageSettings(properties: TextClipProperties, stage: TextSettingsStage): Partial<TextClipProperties> {
  const fields = stage === 'all'
    ? Object.entries(TEXT_NODE_STAGES).filter(([id]) => id !== 'content').flatMap(([, value]) => [...value.fields])
    : TEXT_NODE_STAGES[stage].fields;
  return structuredClone(Object.fromEntries(fields.filter(field => properties[field] !== undefined).map(field => [field, properties[field]])));
}

export interface TextNodePreset { version: 1; name: string; stage: TextSettingsStage; settings: Partial<TextClipProperties> }
export function createTextNodePreset(name: string, stage: TextSettingsStage, properties: TextClipProperties): TextNodePreset {
  return { version: 1, name: name.trim().slice(0, 80) || 'Text style', stage, settings: textStageSettings(properties, stage) };
}

/** Keep optional layout values absent in a preset authoritative (e.g. remove old bounds). */
export function textNodePresetPatch(preset: TextNodePreset): Partial<TextClipProperties> {
  const fields = preset.stage === 'all'
    ? Object.entries(TEXT_NODE_STAGES).filter(([id]) => id !== 'content').flatMap(([, value]) => [...value.fields])
    : TEXT_NODE_STAGES[preset.stage].fields;
  return structuredClone(Object.fromEntries(fields.map(field => [field, preset.settings[field]])));
}
