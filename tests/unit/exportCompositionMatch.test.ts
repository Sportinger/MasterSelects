import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCompositionMatchPatch,
  describeCompositionMismatch,
  resolveCompositionMatch,
  type CompositionFormat,
  type CompositionMatchSettings,
} from '../../src/components/export/exportCompositionMatch';
import { createDefaultExportSettings, useExportStore } from '../../src/stores/exportStore';
import { sanitizeSettings } from '../../src/stores/exportDefinitions';

const MAIN: CompositionFormat = { width: 1920, height: 1080, frameRate: 30 };
const REEL: CompositionFormat = { width: 1080, height: 1920, frameRate: 30 };
const TAPE: CompositionFormat = { width: 788, height: 576, frameRate: 25 };
const UHD: CompositionFormat = { width: 3840, height: 2160, frameRate: 30 };

/** Settings as a project saved before the follow choice was stored (both choices absent). */
function legacy(overrides: Partial<CompositionMatchSettings> = {}): CompositionMatchSettings {
  return {
    width: 1920, height: 1080, customWidth: 1920, customHeight: 1080, useCustomResolution: false,
    fps: 30, customFps: 30, useCustomFps: false,
    ...overrides,
  };
}

/** The export a reel left behind: its size as a custom size, written by "Same as composition". */
const LEFT_BY_REEL = legacy({ customWidth: 1080, customHeight: 1920, useCustomResolution: true });

describe('export follows the composition', () => {
  it('keeps following when the saved format was the format of another composition', () => {
    // A 4:3 tape composition opened after exporting a portrait reel: the export must not stay portrait.
    const match = resolveCompositionMatch(LEFT_BY_REEL, TAPE, [MAIN, REEL, TAPE]);
    expect(match).toEqual({ resolution: true, frameRate: true });
    expect(buildCompositionMatchPatch(LEFT_BY_REEL, match, TAPE)).toEqual({
      customWidth: 788,
      customHeight: 576,
      useCustomResolution: true,
      matchCompositionResolution: true,
      customFps: 25,
      useCustomFps: true,
      matchCompositionFrameRate: true,
    });
  });

  it('follows a saved format that equals the active composition and then has nothing to change', () => {
    const match = resolveCompositionMatch(LEFT_BY_REEL, REEL, [MAIN, REEL]);
    expect(match).toEqual({ resolution: true, frameRate: true });
    expect(buildCompositionMatchPatch(LEFT_BY_REEL, match, REEL)).toBeNull();
  });

  it('treats a preset size that differs from the active composition as a deliberate choice', () => {
    // 1080p picked from the list for a 4K composition, with an unused 1080p composition in the project.
    const match = resolveCompositionMatch(legacy(), UHD, [MAIN, UHD]);
    expect(match.resolution).toBe(false);
    expect(buildCompositionMatchPatch(legacy(), match, UHD)).toBeNull();
  });

  it('lets the stored choice win over what the saved format suggests', () => {
    expect(resolveCompositionMatch({ ...LEFT_BY_REEL, matchCompositionResolution: false, matchCompositionFrameRate: false }, TAPE, [REEL, TAPE]))
      .toEqual({ resolution: false, frameRate: false });
    const following = { ...legacy(), matchCompositionResolution: true, matchCompositionFrameRate: true };
    expect(resolveCompositionMatch(following, UHD, [UHD])).toEqual({ resolution: true, frameRate: true });
    expect(buildCompositionMatchPatch(following, { resolution: true, frameRate: false }, UHD)).toEqual({
      customWidth: 3840,
      customHeight: 2160,
      useCustomResolution: true,
      matchCompositionResolution: true,
    });
  });
});

describe('export format differs from the composition', () => {
  const notFollowing = { resolution: false, frameRate: false };

  it('says that another picture shape adds black bars and another frame rate repeats or drops frames', () => {
    const notes = describeCompositionMismatch(LEFT_BY_REEL, notFollowing, TAPE);
    expect(notes.resolution).toBe('The composition is 788×576. A 1080×1920 export adds black bars.');
    expect(notes.frameRate).toBe('The composition runs at 25 fps. Exporting at 30 fps repeats or drops frames.');
  });

  it('stays quiet for a plain resize and while the export follows the composition', () => {
    expect(describeCompositionMismatch(legacy(), notFollowing, UHD)).toEqual({ resolution: null, frameRate: null });
    expect(describeCompositionMismatch(LEFT_BY_REEL, { resolution: true, frameRate: true }, TAPE))
      .toEqual({ resolution: null, frameRate: null });
  });
});

describe('stored follow choice', () => {
  beforeEach(() => {
    useExportStore.getState().reset();
  });

  it('follows the composition in a new project and stays undecided for settings saved without it', () => {
    expect(createDefaultExportSettings()).toMatchObject({ matchCompositionResolution: true, matchCompositionFrameRate: true });
    const saved = sanitizeSettings({ customWidth: 1080, customHeight: 1920, useCustomResolution: true });
    expect(saved.matchCompositionResolution).toBeUndefined();
    expect(saved.matchCompositionFrameRate).toBeUndefined();
    expect(sanitizeSettings({ matchCompositionResolution: false }).matchCompositionResolution).toBe(false);
  });

  it('stops following when a size or frame rate is set by hand', () => {
    const store = useExportStore.getState();
    store.setSettings({ filename: 'cut' });
    expect(useExportStore.getState().settings).toMatchObject({ matchCompositionResolution: true, matchCompositionFrameRate: true });

    store.setSettings({ width: 1280, height: 720 });
    expect(useExportStore.getState().settings).toMatchObject({ matchCompositionResolution: false, matchCompositionFrameRate: true });

    store.setSettings({ customFps: 24, useCustomFps: true });
    expect(useExportStore.getState().settings.matchCompositionFrameRate).toBe(false);
  });

  it('keeps following when the composition follow-up itself writes the new format', () => {
    const store = useExportStore.getState();
    const match = resolveCompositionMatch(store.settings, TAPE, [MAIN, TAPE]);
    const patch = buildCompositionMatchPatch(store.settings, match, TAPE);
    expect(patch).not.toBeNull();
    store.setSettings(patch!);
    expect(useExportStore.getState().settings).toMatchObject({
      customWidth: 788,
      customHeight: 576,
      useCustomResolution: true,
      customFps: 25,
      useCustomFps: true,
      matchCompositionResolution: true,
      matchCompositionFrameRate: true,
    });
  });
});
