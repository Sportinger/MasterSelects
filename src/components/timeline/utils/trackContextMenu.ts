import type { LabelColor } from '../../../stores/mediaStore/types';

export type TrackContextMenuCommandKind = 'add-track' | 'duplicate-track' | 'delete-track';

export interface TrackContextMenuCommand {
  key: string;
  label: string;
  kind: TrackContextMenuCommandKind;
  trackType?: 'video' | 'audio' | 'midi';
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
}

export interface TrackColorSwatchCommand {
  key: LabelColor;
}

export interface ExecuteTrackContextMenuCommandInput {
  addTrack: (trackType: 'video' | 'audio' | 'midi') => void;
  duplicateTrack: () => void;
  deleteTrack: () => void;
}

export interface ExecuteTrackColorSwatchCommandInput {
  setTrackColor: (color: LabelColor) => void;
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
      { key: 'add-video-track', label: '+ Add Video Track', kind: 'add-track', trackType: 'video' },
      { key: 'add-audio-track', label: '+ Add Audio Track', kind: 'add-track', trackType: 'audio' },
      { key: 'add-midi-track', label: '+ Add MIDI Track', kind: 'add-track', trackType: 'midi' },
    ],
    duplicateCommand: {
      key: 'duplicate-track',
      label: 'Duplicate Track',
      kind: 'duplicate-track',
    },
    deleteCommand: {
      key: 'delete-track',
      label: deleteLabel,
      kind: 'delete-track',
      disabled: deleteDisabled,
      danger: true,
      title: deleteTitle,
    },
  };
}

export function createTrackColorSwatchCommands(
  colors: readonly { key: LabelColor }[],
): TrackColorSwatchCommand[] {
  return colors.map((color) => ({
    key: color.key,
  }));
}

export function executeTrackContextMenuCommand(
  command: TrackContextMenuCommand,
  input: ExecuteTrackContextMenuCommandInput,
): boolean {
  if (command.disabled) return false;

  switch (command.kind) {
    case 'add-track':
      if (!command.trackType) return false;
      input.addTrack(command.trackType);
      return true;
    case 'duplicate-track':
      input.duplicateTrack();
      return true;
    case 'delete-track':
      input.deleteTrack();
      return true;
    default:
      return false;
  }
}

export function executeTrackColorSwatchCommand(
  command: TrackColorSwatchCommand,
  input: ExecuteTrackColorSwatchCommandInput,
): boolean {
  input.setTrackColor(command.key);
  return true;
}
