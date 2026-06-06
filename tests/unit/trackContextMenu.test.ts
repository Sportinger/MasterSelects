import { describe, expect, it, vi } from 'vitest';
import {
  createTrackColorSwatchCommands,
  createTrackContextMenuModel,
  executeTrackColorSwatchCommand,
  executeTrackContextMenuCommand,
} from '../../src/components/timeline/utils/trackContextMenu';

describe('track context menu model', () => {
  it('builds add and duplicate command descriptors without injected actions', () => {
    const model = createTrackContextMenuModel({
      trackName: 'Audio 1',
      trackTypeCount: 2,
      trackClipCount: 0,
    });

    expect(model.addTrackCommands).toEqual([
      { key: 'add-video-track', label: '+ Add Video Track', kind: 'add-track', trackType: 'video' },
      { key: 'add-audio-track', label: '+ Add Audio Track', kind: 'add-track', trackType: 'audio' },
      { key: 'add-midi-track', label: '+ Add MIDI Track', kind: 'add-track', trackType: 'midi' },
    ]);
    expect(model.duplicateCommand).toEqual({
      key: 'duplicate-track',
      label: 'Duplicate Track',
      kind: 'duplicate-track',
    });
  });

  it('disables deleting the last track of a type', () => {
    const model = createTrackContextMenuModel({
      trackName: 'Video 1',
      trackTypeCount: 1,
      trackClipCount: 0,
    });

    expect(model.deleteCommand.disabled).toBe(true);
    expect(model.deleteCommand.danger).toBe(true);
    expect(model.deleteCommand.title).toBe('Cannot delete the last track of this type');
  });

  it('describes clip deletion impact for non-empty tracks', () => {
    const model = createTrackContextMenuModel({
      trackName: 'Audio 2',
      trackTypeCount: 3,
      trackClipCount: 2,
    });

    expect(model.deleteCommand.disabled).toBe(false);
    expect(model.deleteCommand.label).toBe('Delete "Audio 2" (2 clips)');
    expect(model.deleteCommand.title).toBe('Will delete 2 clips');
  });

  it('builds color swatch descriptors without importing the store', () => {
    const commands = createTrackColorSwatchCommands([
      { key: 'none' },
      { key: 'red' },
    ]);

    expect(commands).toEqual([
      { key: 'none' },
      { key: 'red' },
    ]);
  });

  it('executes track command descriptors through explicit handlers', () => {
    const addTrack = vi.fn();
    const duplicateTrack = vi.fn();
    const deleteTrack = vi.fn();
    const model = createTrackContextMenuModel({
      trackName: 'Audio 2',
      trackTypeCount: 2,
      trackClipCount: 0,
    });
    const handlers = { addTrack, duplicateTrack, deleteTrack };

    expect(executeTrackContextMenuCommand(model.addTrackCommands[0], handlers)).toBe(true);
    expect(executeTrackContextMenuCommand(model.addTrackCommands[1], handlers)).toBe(true);
    expect(executeTrackContextMenuCommand(model.duplicateCommand, handlers)).toBe(true);
    expect(executeTrackContextMenuCommand(model.deleteCommand, handlers)).toBe(true);

    expect(addTrack).toHaveBeenNthCalledWith(1, 'video');
    expect(addTrack).toHaveBeenNthCalledWith(2, 'audio');
    expect(duplicateTrack).toHaveBeenCalledTimes(1);
    expect(deleteTrack).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled track command descriptors inert', () => {
    const deleteTrack = vi.fn();
    const model = createTrackContextMenuModel({
      trackName: 'Audio 1',
      trackTypeCount: 1,
      trackClipCount: 0,
    });

    expect(executeTrackContextMenuCommand(model.deleteCommand, {
      addTrack: vi.fn(),
      duplicateTrack: vi.fn(),
      deleteTrack,
    })).toBe(false);
    expect(deleteTrack).not.toHaveBeenCalled();
  });

  it('executes color swatch descriptors through explicit handlers', () => {
    const setTrackColor = vi.fn();
    const commands = createTrackColorSwatchCommands([{ key: 'red' }]);

    expect(executeTrackColorSwatchCommand(commands[0], { setTrackColor })).toBe(true);
    expect(setTrackColor).toHaveBeenCalledWith('red');
  });
});
