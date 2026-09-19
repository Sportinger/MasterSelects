import type { FlockDefinition, FlockGroupDefinition } from '../../types/flock';
import { createFlockGroupFromNodes, remapFlockDefinitionIds } from '../flock/mutations/flockGraphMutations';
import { FLOCK_GROUP_OPERATOR_ID } from '../flock/operators/flockOperatorRegistry';

/**
 * Browser-local library of reusable flock presets: compatible node groups and
 * whole graphs. Stored as versioned JSON; storage failures never throw.
 */

export const FLOCK_PRESET_LIBRARY_STORAGE_KEY = 'masterselects.flock.presetLibrary.v1';
export const FLOCK_PRESET_LIBRARY_VERSION = 1;

export interface FlockLibraryGroupPreset {
  id: string;
  kind: 'group';
  label: string;
  createdAt: number;
  group: FlockGroupDefinition;
}

export interface FlockLibraryGraphPreset {
  id: string;
  kind: 'graph';
  label: string;
  createdAt: number;
  definition: FlockDefinition;
}

export type FlockLibraryPreset = FlockLibraryGroupPreset | FlockLibraryGraphPreset;

export interface FlockPresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let libraryVersion = 0;

function resolveStorage(storage?: FlockPresetStorage | null): FlockPresetStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isGroupDefinition(value: unknown): value is FlockGroupDefinition {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges)
    && Array.isArray(value.inputs)
    && Array.isArray(value.outputs)
    && isRecord(value.layout);
}

function isFlockDefinition(value: unknown): value is FlockDefinition {
  return isRecord(value)
    && value.version === 1
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges)
    && Array.isArray(value.exposed)
    && Array.isArray(value.groups)
    && isRecord(value.layout)
    && isRecord(value.time);
}

function isPreset(value: unknown): value is FlockLibraryPreset {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return false;
  if (value.kind === 'group') return isGroupDefinition(value.group);
  if (value.kind === 'graph') return isFlockDefinition(value.definition);
  return false;
}

export function subscribeFlockPresetLibrary(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFlockPresetLibraryVersion(): number {
  return libraryVersion;
}

function notify(): void {
  libraryVersion += 1;
  for (const listener of listeners) listener();
}

export function listFlockLibraryPresets(storage?: FlockPresetStorage | null): FlockLibraryPreset[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(FLOCK_PRESET_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== FLOCK_PRESET_LIBRARY_VERSION || !Array.isArray(parsed.presets)) {
      return [];
    }
    return parsed.presets.filter(isPreset);
  } catch {
    return [];
  }
}

function writePresets(presets: FlockLibraryPreset[], storage?: FlockPresetStorage | null): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(FLOCK_PRESET_LIBRARY_STORAGE_KEY, JSON.stringify({ version: FLOCK_PRESET_LIBRARY_VERSION, presets }));
  } catch {
    return false;
  }
  notify();
  return true;
}

function generatePresetId(): string {
  return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLabel(label: string, fallback: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : fallback;
}

export function saveFlockGroupPreset(
  label: string,
  group: FlockGroupDefinition,
  storage?: FlockPresetStorage | null,
): FlockLibraryGroupPreset | null {
  const preset: FlockLibraryGroupPreset = {
    id: generatePresetId(),
    kind: 'group',
    label: normalizeLabel(label, group.label),
    createdAt: Date.now(),
    group: { ...structuredClone(group), label: normalizeLabel(label, group.label) },
  };
  return writePresets([...listFlockLibraryPresets(storage), preset], storage) ? preset : null;
}

export function saveFlockGraphPreset(
  label: string,
  definition: FlockDefinition,
  storage?: FlockPresetStorage | null,
): FlockLibraryGraphPreset | null {
  const preset: FlockLibraryGraphPreset = {
    id: generatePresetId(),
    kind: 'graph',
    label: normalizeLabel(label, 'Flock Graph'),
    createdAt: Date.now(),
    definition: structuredClone(definition),
  };
  return writePresets([...listFlockLibraryPresets(storage), preset], storage) ? preset : null;
}

export function removeFlockLibraryPreset(presetId: string, storage?: FlockPresetStorage | null): boolean {
  const presets = listFlockLibraryPresets(storage);
  const next = presets.filter((preset) => preset.id !== presetId);
  return next.length !== presets.length && writePresets(next, storage);
}

export type FlockGroupExtraction =
  | { ok: true; group: FlockGroupDefinition }
  | { ok: false; message: string };

/** Builds a standalone group definition from selected nodes without mutating the clip. */
export function extractFlockGroupPreset(
  definition: FlockDefinition,
  nodeIds: readonly string[],
  label: string,
): FlockGroupExtraction {
  if (nodeIds.length === 0) return { ok: false, message: 'Select nodes to save as a group preset.' };
  const selected = definition.nodes.filter((node) => nodeIds.includes(node.id));
  if (selected.some((node) => node.operator === FLOCK_GROUP_OPERATOR_ID)) {
    return { ok: false, message: 'Selections that already contain groups cannot be saved as a group preset.' };
  }
  const result = createFlockGroupFromNodes(definition, [...nodeIds], normalizeLabel(label, 'Group'));
  if (!result.ok) return { ok: false, message: result.message };
  const group = result.definition.groups.find((candidate) => candidate.id === result.groupId);
  return group ? { ok: true, group: structuredClone(group) } : { ok: false, message: 'Group could not be created.' };
}

/** Fresh node/edge ids so the graph preset is an independent copy on the target clip. */
export function instantiateFlockGraphPreset(preset: FlockLibraryGraphPreset): FlockDefinition {
  return remapFlockDefinitionIds(preset.definition).definition;
}
