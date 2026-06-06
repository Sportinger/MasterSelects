import { describe, expect, it, vi } from 'vitest';
import {
  createAudioRegionContextMenuModel,
  findAudioRegionContextMenuCommand,
} from '../../src/components/timeline/utils/audioRegionContextMenu';
import type { ApplyAudioRegionEditOptions, TimelineAudioRegionEditType } from '../../src/stores/timeline/types';

function createModel(hasAudioRegionClipboard = false) {
  const callbacks = {
    onSplit: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    applyAudioRegionEdit: vi.fn((_type: TimelineAudioRegionEditType, _options?: ApplyAudioRegionEditOptions) => 'edit-id'),
  };
  return {
    callbacks,
    model: createAudioRegionContextMenuModel({
      hasAudioRegionClipboard,
      ...callbacks,
    }),
  };
}

describe('audio region context menu model', () => {
  it('builds direct commands and disables paste when the clipboard is empty', () => {
    const { model } = createModel(false);

    expect(model.directCommands.map(command => command.key)).toEqual(['split', 'cut', 'copy', 'paste']);
    expect(findAudioRegionContextMenuCommand(model, 'paste')?.disabled).toBe(true);
    expect(findAudioRegionContextMenuCommand(model, 'cut')?.danger).toBe(true);
  });

  it('enables paste commands when audio region clipboard data exists', () => {
    const { model } = createModel(true);

    expect(findAudioRegionContextMenuCommand(model, 'paste')?.disabled).toBe(false);
    expect(findAudioRegionContextMenuCommand(model, 'paste-region')?.disabled).toBe(false);
  });

  it('routes direct command actions to supplied callbacks', () => {
    const { callbacks, model } = createModel(true);

    findAudioRegionContextMenuCommand(model, 'split')?.action();
    findAudioRegionContextMenuCommand(model, 'cut')?.action();
    findAudioRegionContextMenuCommand(model, 'copy-region')?.action();
    findAudioRegionContextMenuCommand(model, 'paste-region')?.action();

    expect(callbacks.onSplit).toHaveBeenCalledTimes(1);
    expect(callbacks.onCut).toHaveBeenCalledTimes(1);
    expect(callbacks.onCopy).toHaveBeenCalledTimes(1);
    expect(callbacks.onPaste).toHaveBeenCalledTimes(1);
  });

  it('creates edit commands with the expected keep-selection options', () => {
    const { callbacks, model } = createModel(true);

    findAudioRegionContextMenuCommand(model, 'silence')?.action();
    findAudioRegionContextMenuCommand(model, 'left-mono')?.action();
    findAudioRegionContextMenuCommand(model, 'fx-compressor')?.action();
    findAudioRegionContextMenuCommand(model, 'hum-notch')?.action();

    expect(callbacks.applyAudioRegionEdit).toHaveBeenCalledWith('silence', { keepSelection: true });
    expect(callbacks.applyAudioRegionEdit).toHaveBeenCalledWith('split-stereo', {
      keepSelection: true,
      params: { sourceChannel: 0, label: 'Left to mono' },
    });
    expect(callbacks.applyAudioRegionEdit).toHaveBeenCalledWith('effect', expect.objectContaining({
      keepSelection: true,
      params: expect.objectContaining({
        effectDescriptorId: 'audio-compressor',
        effectLabel: 'Compressor',
        featherTime: 0.015,
      }),
    }));
    expect(callbacks.applyAudioRegionEdit).toHaveBeenCalledWith('repair', {
      keepSelection: true,
      params: expect.objectContaining({
        label: '50 Hz notch',
        repairType: 'hum-notch',
        baseFrequencyHz: 50,
      }),
    });
  });
});
