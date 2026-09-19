import { describe, expect, it, vi } from 'vitest';
import {
  createTimelineEmptyContextMenuModel,
  executeTimelineEmptyContextMenuCommand,
  parseFlockLayerTarget,
} from '../../src/components/timeline/utils/timelineEmptyContextMenu';
import { FLOCK_PRESETS } from '../../src/services/flock/presets/flockPresets';

describe('timeline empty context menu model', () => {
  it('builds gap and view command descriptors with timeline coordinates', () => {
    const model = createTimelineEmptyContextMenuModel({
      time: 12.5,
      trackId: 'track-a',
    });

    expect(model.clipboardCommands).toEqual([{
      key: 'paste-clips',
      label: 'Paste',
      kind: 'paste-clips',
      enabled: false,
      payload: { time: 12.5, trackId: 'track-a' },
    }]);

    expect(model.gapCommands).toEqual([
      {
        key: 'erase-gap',
        label: 'Erase Space Between Clips',
        kind: 'erase-gap',
        payload: { time: 12.5, trackId: 'track-a' },
      },
      {
        key: 'erase-layer-gaps',
        label: 'Erase Space Between All Clips in This Layer',
        kind: 'erase-layer-gaps',
        payload: { time: 12.5, trackId: 'track-a' },
      },
      {
        key: 'erase-all-gaps',
        label: 'Erase Space Between All Clips',
        kind: 'erase-all-gaps',
      },
    ]);
    expect(model.viewCommands).toEqual([{
      key: 'fit-comp-to-window',
      label: 'Fit Comp to Window',
      kind: 'fit-comp-to-window',
    }]);
  });

  it('executes empty-menu descriptors through explicit handlers', () => {
    const onEraseGap = vi.fn();
    const onEraseLayerGaps = vi.fn();
    const onEraseAllGaps = vi.fn();
    const onFitCompToWindow = vi.fn();
    const model = createTimelineEmptyContextMenuModel({
      time: 12.5,
      trackId: 'track-a',
    });
    const handlers = {
      onEraseGap,
      onEraseLayerGaps,
      onEraseAllGaps,
      onFitCompToWindow,
    };

    expect(executeTimelineEmptyContextMenuCommand(model.gapCommands[0], handlers)).toBe(true);
    expect(executeTimelineEmptyContextMenuCommand(model.gapCommands[1], handlers)).toBe(true);
    expect(executeTimelineEmptyContextMenuCommand(model.gapCommands[2], handlers)).toBe(true);
    expect(executeTimelineEmptyContextMenuCommand(model.viewCommands[0], handlers)).toBe(true);

    expect(onEraseGap).toHaveBeenCalledWith(12.5, 'track-a');
    expect(onEraseLayerGaps).toHaveBeenCalledWith(12.5, 'track-a');
    expect(onEraseAllGaps).toHaveBeenCalledTimes(1);
    expect(onFitCompToWindow).toHaveBeenCalledTimes(1);
  });

  it('pastes clips at the clicked timeline position when clipboard data is available', () => {
    const onPasteClips = vi.fn();
    const model = createTimelineEmptyContextMenuModel({
      time: 8.75,
      trackId: 'track-video',
      trackType: 'video',
      canPasteClips: true,
    });

    expect(executeTimelineEmptyContextMenuCommand(model.clipboardCommands[0], {
      onPasteClips,
      onEraseGap: vi.fn(),
      onEraseLayerGaps: vi.fn(),
      onEraseAllGaps: vi.fn(),
      onFitCompToWindow: vi.fn(),
    })).toBe(true);
    expect(onPasteClips).toHaveBeenCalledWith(8.75, 'track-video');
  });

  it('offers and executes caption creation on video tracks', () => {
    const onAddCaptionClip = vi.fn();
    const model = createTimelineEmptyContextMenuModel({
      time: 7.25,
      trackId: 'video-track',
      trackType: 'video',
    });
    const captionCommand = model.sceneCommands.find(
      command => command.kind === 'add-caption-clip',
    );

    expect(captionCommand?.label).toBe('Add Caption Clip');
    expect(executeTimelineEmptyContextMenuCommand(captionCommand!, {
      onAddCaptionClip,
      onEraseGap: vi.fn(),
      onEraseLayerGaps: vi.fn(),
      onEraseAllGaps: vi.fn(),
      onFitCompToWindow: vi.fn(),
    })).toBe(true);
    expect(onAddCaptionClip).toHaveBeenCalledWith(7.25, 'video-track');
  });

  it('offers timeline-native layer creation only on video tracks', () => {
    const videoModel = createTimelineEmptyContextMenuModel({
      time: 4.5,
      trackId: 'video-track',
      trackType: 'video',
    });
    const audioModel = createTimelineEmptyContextMenuModel({
      time: 4.5,
      trackId: 'audio-track',
      trackType: 'audio',
    });

    expect(videoModel.layerCommands.map(command => command.label)).toEqual(expect.arrayContaining([
      'Text',
      'Solid',
      '3D Text',
      'Camera',
      'Light',
      '3D Effector',
      'Motion Null',
      'Adjustment Layer',
      'Rectangle',
      'Math Scene',
    ]));
    expect(audioModel.layerCommands).toEqual([]);
  });

  it('offers every flock preset in the generators group', () => {
    const model = createTimelineEmptyContextMenuModel({
      time: 3,
      trackId: 'video-track',
      trackType: 'video',
    });
    const generators = model.layerCommands.filter(command => command.group === 'generators');

    expect(generators.map(command => command.label)).toEqual(
      FLOCK_PRESETS.map(preset => `Flock: ${preset.label}`),
    );
    expect(generators.map(command => parseFlockLayerTarget(command.payload!.layerTarget!))).toEqual(
      FLOCK_PRESETS.map(preset => preset.id),
    );
    expect(parseFlockLayerTarget('math-scene')).toBeNull();
  });

  it('executes a timeline-native layer command with clicked coordinates', () => {
    const onAddTimelineLayer = vi.fn();
    const model = createTimelineEmptyContextMenuModel({
      time: 9.75,
      trackId: 'video-track',
      trackType: 'video',
    });
    const cameraCommand = model.layerCommands.find(
      command => command.payload?.layerTarget === 'camera',
    );

    expect(executeTimelineEmptyContextMenuCommand(cameraCommand!, {
      onAddTimelineLayer,
      onEraseGap: vi.fn(),
      onEraseLayerGaps: vi.fn(),
      onEraseAllGaps: vi.fn(),
      onFitCompToWindow: vi.fn(),
    })).toBe(true);
    expect(onAddTimelineLayer).toHaveBeenCalledWith(9.75, 'video-track', 'camera');
  });
});
