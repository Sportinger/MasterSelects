import { describe, expect, it } from 'vitest';
import {
  applyAudioEqPreset,
  copyAudioEqABSlot,
  copyAudioEqBands,
  copyAudioEqCurve,
  createAudioEqABState,
  findAudioEqFactoryPreset,
  getAudioEqFactoryPresets,
  normalizeAudioEqParams,
  parseAudioEqClipboardPayload,
  pasteAudioEqClipboardPayload,
  serializeAudioEqClipboardPayload,
  switchAudioEqABSlot,
  syncAudioEqABActiveSlot,
} from '../../../src/engine/audio';
import {
  clearAudioEqUserPresets,
  createAndSaveAudioEqUserPreset,
  deleteAudioEqUserPreset,
  loadAudioEqPresetFavoriteIds,
  loadAudioEqUserPresets,
  toggleAudioEqPresetFavoriteId,
} from '../../../src/services/audio/audioEqPresetStorage';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('audio eq workflow helpers', () => {
  it('exposes cloned factory presets and applies bands/settings independently', () => {
    const presets = getAudioEqFactoryPresets();
    const mastering = findAudioEqFactoryPreset('factory-mastering-polish');
    const current = normalizeAudioEqParams({ band1k: 4 });

    expect(presets.length).toBeGreaterThan(3);
    expect(mastering).not.toBeNull();
    if (!mastering) throw new Error('missing mastering preset');

    const bandsOnly = applyAudioEqPreset(current, mastering, 'bands');
    expect(bandsOnly.audible.phaseMode).toBe(current.audible.phaseMode);
    expect(bandsOnly.audible.bands.map(band => band.id)).toContain('presence');

    const settingsOnly = applyAudioEqPreset(current, mastering, 'settings');
    expect(settingsOnly.audible.bands).toEqual(current.audible.bands);
    expect(settingsOnly.audible.phaseMode).toBe('natural');
    expect(settingsOnly.audible.characterMode).toBe('subtle');
  });

  it('serializes full-curve clipboard payloads and restores canonical params', () => {
    const source = normalizeAudioEqParams({ band1k: 3, band8k: -2 });
    const payload = copyAudioEqCurve(source, 'fx-eq', '2026-05-26T00:00:00.000Z');
    const parsed = parseAudioEqClipboardPayload(serializeAudioEqClipboardPayload(payload));

    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('clipboard parse failed');
    expect(parsed.sourceEffectId).toBe('fx-eq');

    const pasted = pasteAudioEqClipboardPayload(normalizeAudioEqParams({}), parsed);
    expect(pasted.audible.bands.find(band => band.id === 'band1k')).toMatchObject({ gainDb: 3 });
    expect(pasted.audible.bands.find(band => band.id === 'band8k')).toMatchObject({ gainDb: -2 });
  });

  it('copies selected bands and appends with stable unique ids', () => {
    const source = normalizeAudioEqParams({ band1k: 3 });
    const payload = copyAudioEqBands(source, ['band1k'], undefined, '2026-05-26T00:00:00.000Z');
    const pasted = pasteAudioEqClipboardPayload(source, payload, 'append');

    expect(payload.bands).toHaveLength(1);
    expect(pasted.audible.bands).toHaveLength(source.audible.bands.length + 1);
    expect(pasted.audible.bands.some(band => band.id === 'band1k-2')).toBe(true);
  });

  it('keeps A/B state local and returns params to commit when switching', () => {
    const slotA = normalizeAudioEqParams({ band1k: 2 });
    const slotBEdit = normalizeAudioEqParams({ band1k: -5 });
    const initial = createAudioEqABState(slotA);
    const withActiveEdit = syncAudioEqABActiveSlot(initial, slotA);
    const copied = copyAudioEqABSlot(withActiveEdit, 'A', 'B');
    const switchedToB = switchAudioEqABSlot(copied, slotBEdit, 'B');

    expect(switchedToB.params.audible.bands.find(band => band.id === 'band1k')).toMatchObject({ gainDb: 2 });
    expect(switchedToB.state.slots.A.audible.bands.find(band => band.id === 'band1k')).toMatchObject({ gainDb: -5 });
    expect(switchedToB.state.activeSlot).toBe('B');
  });

  it('persists user presets through the storage adapter', () => {
    const storage = new MemoryStorage();
    const params = normalizeAudioEqParams({ band2k: 5 });

    const saved = createAndSaveAudioEqUserPreset({
      id: 'voice-bright',
      name: 'Voice Bright',
      tags: ['voice', 'bright'],
      params,
      now: '2026-05-26T00:00:00.000Z',
    }, storage);

    expect(saved).toHaveLength(1);
    expect(loadAudioEqUserPresets(storage)[0]).toMatchObject({
      id: 'voice-bright',
      name: 'Voice Bright',
      builtin: false,
    });

    expect(deleteAudioEqUserPreset('voice-bright', storage)).toEqual([]);
    clearAudioEqUserPresets(storage);
    expect(loadAudioEqUserPresets(storage)).toEqual([]);
  });

  it('persists preset browser favorites independently from user presets', () => {
    const storage = new MemoryStorage();

    expect(toggleAudioEqPresetFavoriteId('factory-mastering-polish', storage)).toEqual(['factory-mastering-polish']);
    expect(loadAudioEqPresetFavoriteIds(storage)).toEqual(['factory-mastering-polish']);
    expect(toggleAudioEqPresetFavoriteId('factory-mastering-polish', storage)).toEqual([]);
  });
});
