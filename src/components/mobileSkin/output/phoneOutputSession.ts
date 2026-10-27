// The phone output editor edits the live Output Manager state (slice store + output targets), so the
// preview shows every change at once. Opening the editor takes a plain-data snapshot of that state;
// Done saves the mapping (the desktop "Save & Exit"), Cancel puts the snapshot back exactly, including
// the saved copy in browser storage. Output mappings are not part of the project undo history on any
// device (the desktop Output Manager auto-saves them per project), so this snapshot is the phone's
// cancel boundary.

import { Logger } from '../../../services/logger';
import { useRenderTargetStore } from '../../../stores/renderTargetStore';
import { getOutputManagerStorageKey, useSliceStore } from '../../../stores/sliceStore';
import type { RenderSource } from '../../../types/renderTarget';
import type { TargetSliceConfig } from '../../../types/outputSlice';
import {
  listOutputTargets, registerClosedOutputTarget, removeOutputTarget, restoreSavedOutputTargets, routeOutputTargetSource,
} from '../../outputManager/outputTargetCommands';
import { outputSourceKey } from '../../outputManager/outputSourceOptions';

const log = Logger.create('PhoneOutput');

export interface OutputTargetSnapshot {
  id: string;
  name: string;
  source: RenderSource;
  enabled: boolean;
  isFullscreen: boolean;
}

export interface OutputMappingSnapshot {
  storageKey: string;
  configs: Record<string, TargetSliceConfig>;
  targets: OutputTargetSnapshot[];
  storedConfigs: string | null;
  storedTargets: string | null;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  const store = storage();
  if (!store) return;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch (error) {
    log.warn(`Could not restore the saved output mapping "${key}"`, error);
  }
}

function cloneConfigs(configs: Map<string, TargetSliceConfig>): Record<string, TargetSliceConfig> {
  const plain: Record<string, TargetSliceConfig> = {};
  for (const [id, config] of configs) plain[id] = config;
  return JSON.parse(JSON.stringify(plain)) as Record<string, TargetSliceConfig>;
}

/** Loads the project's saved mapping (like the desktop Output Manager does when it opens). */
export function loadSavedOutputMapping(): void {
  useSliceStore.getState().loadFromLocalStorage();
  restoreSavedOutputTargets();
}

export function captureOutputMapping(): OutputMappingSnapshot {
  const storageKey = getOutputManagerStorageKey();
  return {
    storageKey,
    configs: cloneConfigs(useSliceStore.getState().configs),
    targets: listOutputTargets().map((target) => ({
      id: target.id,
      name: target.name,
      source: JSON.parse(JSON.stringify(target.source)) as RenderSource,
      enabled: target.enabled,
      isFullscreen: target.isFullscreen,
    })),
    storedConfigs: readStored(storageKey),
    storedTargets: readStored(`${storageKey}_targets`),
  };
}

/** Puts targets, slices, masks and the saved copy back exactly as they were in `snapshot`. */
export function restoreOutputMapping(snapshot: OutputMappingSnapshot): void {
  const keep = new Set(snapshot.targets.map((target) => target.id));
  for (const target of listOutputTargets()) {
    if (!keep.has(target.id)) removeOutputTarget(target.id);
  }
  for (const saved of snapshot.targets) {
    const store = useRenderTargetStore.getState();
    const current = store.targets.get(saved.id);
    if (!current) {
      registerClosedOutputTarget(saved.id, saved.name, saved.source, saved.isFullscreen);
      if (saved.enabled) useRenderTargetStore.getState().setTargetEnabled(saved.id, true);
      continue;
    }
    if (current.name !== saved.name) store.updateTargetName(saved.id, saved.name);
    if (outputSourceKey(current.source) !== outputSourceKey(saved.source)) routeOutputTargetSource(saved.id, saved.source);
    if (current.enabled !== saved.enabled) store.setTargetEnabled(saved.id, saved.enabled);
  }
  const configs = new Map<string, TargetSliceConfig>(Object.entries(JSON.parse(JSON.stringify(snapshot.configs)) as Record<string, TargetSliceConfig>));
  useSliceStore.setState({ configs });
  // The saved copy follows: the store's own save cannot remove a target list it wrote meanwhile.
  writeStored(snapshot.storageKey, snapshot.storedConfigs);
  writeStored(`${snapshot.storageKey}_targets`, snapshot.storedTargets);
}

/** Done: the mapping as it is now becomes the project's saved output mapping. */
export function saveOutputMapping(): boolean {
  const key = getOutputManagerStorageKey();
  useSliceStore.getState().saveToLocalStorage();
  // The store keeps an old target list when no target is left; an emptied mapping must stay empty.
  if (listOutputTargets().length === 0) writeStored(`${key}_targets`, null);
  const saved = readStored(key) !== null;
  if (!saved) log.warn('The output mapping could not be saved: browser storage is not available');
  return saved;
}
