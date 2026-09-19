import { describe, expect, it, vi } from 'vitest';
import {
  FLOCK_PRESET_LIBRARY_STORAGE_KEY,
  extractFlockGroupPreset,
  instantiateFlockGraphPreset,
  listFlockLibraryPresets,
  removeFlockLibraryPreset,
  saveFlockGraphPreset,
  saveFlockGroupPreset,
  subscribeFlockPresetLibrary,
  type FlockPresetStorage,
} from '../../src/services/nodeGraph/flockGroupPresetLibrary';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { createFlockGroupFromNodes } from '../../src/services/flock/mutations/flockGraphMutations';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';

function memoryStorage(): FlockPresetStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('flock preset library', () => {
  it('saves, lists and removes group and graph presets', () => {
    const storage = memoryStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeFlockPresetLibrary(listener);
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = definition.nodes.find((node) => node.operator === 'flock.turbulence')!;

    const extraction = extractFlockGroupPreset(definition, [turbulence.id], 'Swirl Forces');
    expect(extraction.ok).toBe(true);
    if (!extraction.ok) return;
    expect(extraction.group.outputs.map((binding) => binding.type)).toEqual(['behavior']);
    // Extraction never mutates the source definition.
    expect(definition.groups).toHaveLength(0);

    const group = saveFlockGroupPreset('Swirl Forces', extraction.group, storage);
    const graph = saveFlockGraphPreset('My Swarm', definition, storage);
    expect(group?.kind).toBe('group');
    expect(graph?.kind).toBe('graph');
    expect(listFlockLibraryPresets(storage).map((preset) => preset.label)).toEqual(['Swirl Forces', 'My Swarm']);
    expect(listener).toHaveBeenCalledTimes(2);

    expect(removeFlockLibraryPreset(group!.id, storage)).toBe(true);
    expect(listFlockLibraryPresets(storage).map((preset) => preset.kind)).toEqual(['graph']);
    unsubscribe();
  });

  it('instantiates graph presets as independent, compilable copies', () => {
    const storage = memoryStorage();
    const definition = createFlockPresetDefinition('technical-network');
    const preset = saveFlockGraphPreset('Network', definition, storage)!;
    const copy = instantiateFlockGraphPreset(preset);
    expect(copy.nodes.map((node) => node.id)).not.toEqual(definition.nodes.map((node) => node.id));
    expect(compileFlockDefinition(copy).ok).toBe(true);
  });

  it('tolerates failing and corrupted storage', () => {
    const throwing: FlockPresetStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(listFlockLibraryPresets(throwing)).toEqual([]);
    expect(saveFlockGraphPreset('x', createFlockPresetDefinition('vortex'), throwing)).toBeNull();
    expect(listFlockLibraryPresets(null)).toEqual([]);

    const corrupted = memoryStorage();
    corrupted.data.set(FLOCK_PRESET_LIBRARY_STORAGE_KEY, '{not json');
    expect(listFlockLibraryPresets(corrupted)).toEqual([]);
    corrupted.data.set(FLOCK_PRESET_LIBRARY_STORAGE_KEY, JSON.stringify({ version: 1, presets: [{ id: 'bad', kind: 'group' }] }));
    expect(listFlockLibraryPresets(corrupted)).toEqual([]);
  });

  it('rejects selections that already contain groups', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = definition.nodes.find((node) => node.operator === 'flock.turbulence')!;
    const grouped = createFlockGroupFromNodes(definition, [turbulence.id], 'Inner');
    if (!grouped.ok) throw new Error(grouped.message);
    const result = extractFlockGroupPreset(grouped.definition, [grouped.groupNodeId], 'Outer');
    expect(result.ok).toBe(false);
  });
});
