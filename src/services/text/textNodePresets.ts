import { DEFAULT_TEXT_PROPERTIES } from '../../stores/timeline/constants';
import { createTextNodePreset, textNodePresetPatch, TEXT_NODE_STAGES, type TextNodePreset, type TextSettingsStage } from './textNodeStages';
import type { TextClipProperties } from '../../types/text';

const STORAGE_KEY = 'masterselects.text-node-presets.v1';
export interface SavedTextNodePreset extends TextNodePreset { id: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const point = (value: unknown) => record(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y);

export function isTextNodePreset(value: unknown): value is SavedTextNodePreset {
  if (!record(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string'
    || value.name.length > 80 || !record(value.settings) || typeof value.stage !== 'string'
    || !['all', 'typography', 'layout', 'fill', 'stroke', 'shadow'].includes(value.stage)) return false;
  const fields = value.stage === 'all' ? Object.entries(TEXT_NODE_STAGES).filter(([id]) => id !== 'content').flatMap(([, stage]) => [...stage.fields])
    : TEXT_NODE_STAGES[value.stage as Exclude<TextSettingsStage, 'all'>].fields;
  if (Object.keys(value.settings).some(key => !(fields as readonly string[]).includes(key))) return false;
  const settings = value.settings;
  for (const field of fields) {
    const item = settings[field], fallback = DEFAULT_TEXT_PROPERTIES[field];
    if (item === undefined) { if (fallback !== undefined && field !== 'boxEnabled') return false; continue; }
    if (field === 'pathPoints') {
      if (!Array.isArray(item) || !item.every(p => point(p) && record(p) && point(p.handleIn) && point(p.handleOut))) return false;
    } else if (field === 'textBounds') {
      if (!record(item) || typeof item.id !== 'string' || typeof item.closed !== 'boolean' || !point(item.position)
        || !Array.isArray(item.vertices) || !item.vertices.every(vertex => record(vertex) && typeof vertex.id === 'string'
          && point(vertex) && point(vertex.handleIn) && point(vertex.handleOut))) return false;
    } else if (typeof fallback === 'number' || field.startsWith('box') && field !== 'boxEnabled') {
      if (typeof item !== 'number' || !Number.isFinite(item)) return false;
    } else if (typeof fallback === 'boolean' || field === 'boxEnabled') {
      if (typeof item !== 'boolean') return false;
    } else if (typeof item !== 'string') return false;
  }
  const enums: Record<string, string[]> = { fontStyle: ['normal', 'italic'], textAlign: ['left', 'center', 'right'], verticalAlign: ['top', 'middle', 'bottom'], wrapMode: ['word', 'none'] };
  return Object.entries(enums).every(([field, values]) => settings[field] === undefined || values.includes(String(settings[field])));
}

export function listTextNodePresets(): SavedTextNodePreset[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  if (raw.length > 1_000_000) throw new Error('Text preset library is too large.');
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 100 || !values.every(isTextNodePreset)) throw new Error('Text preset library is invalid.');
  return values;
}

export function saveTextNodePreset(name: string, stage: TextSettingsStage, properties: TextClipProperties): SavedTextNodePreset {
  const values = listTextNodePresets();
  if (values.length >= 100) throw new Error('The text preset library is full.');
  const preset = { ...createTextNodePreset(name, stage, properties), id: crypto.randomUUID() };
  if (!isTextNodePreset(preset)) throw new Error('These text settings cannot be saved as a preset.');
  const serialized = JSON.stringify([...values, preset]);
  if (serialized.length > 1_000_000) throw new Error('Text preset library is too large.');
  localStorage.setItem(STORAGE_KEY, serialized);
  return preset;
}

export function applyTextNodePresetSettings(preset: SavedTextNodePreset): Partial<TextClipProperties> {
  if (!isTextNodePreset(preset)) throw new Error('Invalid text preset.');
  return textNodePresetPatch(preset);
}
