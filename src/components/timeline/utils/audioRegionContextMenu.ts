import type {
  ApplyAudioRegionEditOptions,
  TimelineAudioRegionEditType,
} from '../../../stores/timeline/types';
import { AUDIO_REGION_FX_PRESETS } from './audioRegionDisplay';

export type ApplyAudioRegionEdit = (
  type: TimelineAudioRegionEditType,
  options?: ApplyAudioRegionEditOptions,
) => string | null;

export interface AudioRegionContextMenuCommand {
  key: string;
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface AudioRegionContextMenuGroup {
  key: string;
  label: string;
  commands: AudioRegionContextMenuCommand[];
}

export interface AudioRegionContextMenuModel {
  directCommands: AudioRegionContextMenuCommand[];
  groups: AudioRegionContextMenuGroup[];
}

export interface CreateAudioRegionContextMenuModelInput {
  hasAudioRegionClipboard: boolean;
  onSplit: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  applyAudioRegionEdit: ApplyAudioRegionEdit;
}

const KEEP_AUDIO_REGION_SELECTION = { keepSelection: true } as const;

export function createAudioRegionContextMenuModel(input: CreateAudioRegionContextMenuModelInput): AudioRegionContextMenuModel {
  const directCommands: AudioRegionContextMenuCommand[] = [
    { key: 'split', label: 'Split', action: input.onSplit },
    { key: 'cut', label: 'Cut', action: input.onCut, danger: true },
    { key: 'copy', label: 'Copy', action: input.onCopy },
    {
      key: 'paste',
      label: 'Paste',
      action: input.onPaste,
      disabled: !input.hasAudioRegionClipboard,
    },
  ];

  const groups: AudioRegionContextMenuGroup[] = [
    {
      key: 'clipboard',
      label: 'Clipboard',
      commands: [
        { key: 'copy-region', label: 'Copy Region', action: input.onCopy },
        {
          key: 'paste-region',
          label: 'Paste Into Region',
          action: input.onPaste,
          disabled: !input.hasAudioRegionClipboard,
        },
      ],
    },
    {
      key: 'time',
      label: 'Time',
      commands: [
        { key: 'silence', label: 'Silence', action: () => input.applyAudioRegionEdit('silence', KEEP_AUDIO_REGION_SELECTION) },
        { key: 'insert-silence', label: 'Insert Silence', action: () => input.applyAudioRegionEdit('insert-silence', KEEP_AUDIO_REGION_SELECTION) },
        { key: 'delete-silence', label: 'Delete Audio', action: () => input.applyAudioRegionEdit('delete-silence', KEEP_AUDIO_REGION_SELECTION), danger: true },
      ],
    },
    {
      key: 'polarity',
      label: 'Direction',
      commands: [
        { key: 'reverse', label: 'Reverse', action: () => input.applyAudioRegionEdit('reverse', KEEP_AUDIO_REGION_SELECTION) },
        { key: 'invert-polarity', label: 'Invert Polarity', action: () => input.applyAudioRegionEdit('invert-polarity', KEEP_AUDIO_REGION_SELECTION) },
      ],
    },
    {
      key: 'channels',
      label: 'Channels',
      commands: [
        { key: 'swap-channels', label: 'Swap L/R', action: () => input.applyAudioRegionEdit('swap-channels', KEEP_AUDIO_REGION_SELECTION) },
        { key: 'mono-sum', label: 'Mono Sum', action: () => input.applyAudioRegionEdit('mono-sum', KEEP_AUDIO_REGION_SELECTION) },
        {
          key: 'left-mono',
          label: 'Left To Mono',
          action: () => input.applyAudioRegionEdit('split-stereo', {
            keepSelection: true,
            params: { sourceChannel: 0, label: 'Left to mono' },
          }),
        },
        {
          key: 'right-mono',
          label: 'Right To Mono',
          action: () => input.applyAudioRegionEdit('split-stereo', {
            keepSelection: true,
            params: { sourceChannel: 1, label: 'Right to mono' },
          }),
        },
      ],
    },
    {
      key: 'fx',
      label: 'Region FX',
      commands: AUDIO_REGION_FX_PRESETS.map(preset => ({
        key: preset.key,
        label: preset.label,
        action: () => input.applyAudioRegionEdit('effect', {
          keepSelection: true,
          params: {
            label: preset.label,
            effectLabel: preset.label,
            effectDescriptorId: preset.descriptorId,
            featherTime: 0.015,
            ...preset.params,
          },
        }),
      })),
    },
    {
      key: 'repair',
      label: 'Repair',
      commands: [
        {
          key: 'hum-notch',
          label: '50 Hz Notch',
          action: () => input.applyAudioRegionEdit('repair', {
            keepSelection: true,
            params: { label: '50 Hz notch', repairType: 'hum-notch', baseFrequencyHz: 50, harmonicCount: 6, q: 35, featherTime: 0.02 },
          }),
        },
        {
          key: 'de-click',
          label: 'De-click',
          action: () => input.applyAudioRegionEdit('repair', {
            keepSelection: true,
            params: { label: 'De-click', repairType: 'de-click', threshold: 0.35, ratio: 4 },
          }),
        },
        {
          key: 'splice-smooth',
          label: 'Smooth Edge',
          action: () => input.applyAudioRegionEdit('repair', {
            keepSelection: true,
            params: { label: 'Smooth edge', repairType: 'splice-smooth', edgeSeconds: 0.008 },
          }),
        },
        {
          key: 'loudness-match',
          label: 'Match RMS',
          action: () => input.applyAudioRegionEdit('repair', {
            keepSelection: true,
            params: { label: 'Match RMS', repairType: 'loudness-match', targetDb: -20, minGainDb: -24, maxGainDb: 24, featherTime: 0.01 },
          }),
        },
      ],
    },
  ];

  return { directCommands, groups };
}

export function findAudioRegionContextMenuCommand(
  model: AudioRegionContextMenuModel,
  key: string,
): AudioRegionContextMenuCommand | undefined {
  return model.directCommands.find(command => command.key === key) ??
    model.groups
      .flatMap(group => group.commands)
      .find(command => command.key === key);
}
