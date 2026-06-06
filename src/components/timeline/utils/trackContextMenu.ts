import type { LabelColor } from '../../../stores/mediaStore/types';

export interface TrackContextMenuCommand {
  key: string;
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}

export interface TrackContextMenuModel {
  addTrackCommands: TrackContextMenuCommand[];
  duplicateCommand: TrackContextMenuCommand;
  deleteCommand: TrackContextMenuCommand;
}

export interface CreateTrackContextMenuModelInput {
  trackName: string;
  trackTypeCount: number;
  trackClipCount: number;
  onAddTrack: (trackType: 'video' | 'audio' | 'midi') => void;
  onDuplicateTrack: () => void;
  onDeleteTrack: () => void;
}

export interface TrackColorSwatchCommand {
  key: LabelColor;
  action: () => void;
}

export function createTrackContextMenuModel(input: CreateTrackContextMenuModelInput): TrackContextMenuModel {
  const deleteDisabled = input.trackTypeCount <= 1;
  const deleteTitle = deleteDisabled
    ? 'Cannot delete the last track of this type'
    : input.trackClipCount > 0
      ? `Will delete ${input.trackClipCount} clip${input.trackClipCount > 1 ? 's' : ''}`
      : undefined;
  const deleteLabel = `Delete "${input.trackName}"${input.trackClipCount > 0 ? ` (${input.trackClipCount} clips)` : ''}`;

  return {
    addTrackCommands: [
      { key: 'add-video-track', label: '+ Add Video Track', action: () => input.onAddTrack('video') },
      { key: 'add-audio-track', label: '+ Add Audio Track', action: () => input.onAddTrack('audio') },
      { key: 'add-midi-track', label: '+ Add MIDI Track', action: () => input.onAddTrack('midi') },
    ],
    duplicateCommand: {
      key: 'duplicate-track',
      label: 'Duplicate Track',
      action: input.onDuplicateTrack,
    },
    deleteCommand: {
      key: 'delete-track',
      label: deleteLabel,
      action: input.onDeleteTrack,
      disabled: deleteDisabled,
      danger: true,
      title: deleteTitle,
    },
  };
}

export function createTrackColorSwatchCommands(
  colors: readonly { key: LabelColor }[],
  onSetTrackColor: (color: LabelColor) => void,
): TrackColorSwatchCommand[] {
  return colors.map((color) => ({
    key: color.key,
    action: () => onSetTrackColor(color.key),
  }));
}
