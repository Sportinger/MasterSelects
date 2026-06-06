import { describe, expect, it, vi } from 'vitest';
import {
  createTrackColorSwatchCommands,
  createTrackContextMenuModel,
} from '../../src/components/timeline/utils/trackContextMenu';

describe('track context menu model', () => {
  it('builds add and duplicate commands with injected actions', () => {
    const onAddTrack = vi.fn();
    const onDuplicateTrack = vi.fn();
    const model = createTrackContextMenuModel({
      trackName: 'Audio 1',
      trackTypeCount: 2,
      trackClipCount: 0,
      onAddTrack,
      onDuplicateTrack,
      onDeleteTrack: vi.fn(),
    });

    expect(model.addTrackCommands.map(command => command.key)).toEqual([
      'add-video-track',
      'add-audio-track',
      'add-midi-track',
    ]);

    model.addTrackCommands[0].action();
    model.addTrackCommands[1].action();
    model.addTrackCommands[2].action();
    model.duplicateCommand.action();

    expect(onAddTrack).toHaveBeenNthCalledWith(1, 'video');
    expect(onAddTrack).toHaveBeenNthCalledWith(2, 'audio');
    expect(onAddTrack).toHaveBeenNthCalledWith(3, 'midi');
    expect(onDuplicateTrack).toHaveBeenCalledTimes(1);
  });

  it('disables deleting the last track of a type', () => {
    const model = createTrackContextMenuModel({
      trackName: 'Video 1',
      trackTypeCount: 1,
      trackClipCount: 0,
      onAddTrack: vi.fn(),
      onDuplicateTrack: vi.fn(),
      onDeleteTrack: vi.fn(),
    });

    expect(model.deleteCommand.disabled).toBe(true);
    expect(model.deleteCommand.danger).toBe(true);
    expect(model.deleteCommand.title).toBe('Cannot delete the last track of this type');
  });

  it('describes clip deletion impact for non-empty tracks', () => {
    const onDeleteTrack = vi.fn();
    const model = createTrackContextMenuModel({
      trackName: 'Audio 2',
      trackTypeCount: 3,
      trackClipCount: 2,
      onAddTrack: vi.fn(),
      onDuplicateTrack: vi.fn(),
      onDeleteTrack,
    });

    expect(model.deleteCommand.disabled).toBe(false);
    expect(model.deleteCommand.label).toBe('Delete "Audio 2" (2 clips)');
    expect(model.deleteCommand.title).toBe('Will delete 2 clips');

    model.deleteCommand.action();
    expect(onDeleteTrack).toHaveBeenCalledTimes(1);
  });

  it('builds color swatch commands without importing the store', () => {
    const onSetTrackColor = vi.fn();
    const commands = createTrackColorSwatchCommands([
      { key: 'none' },
      { key: 'red' },
    ], onSetTrackColor);

    commands[1].action();
    expect(onSetTrackColor).toHaveBeenCalledWith('red');
  });
});
