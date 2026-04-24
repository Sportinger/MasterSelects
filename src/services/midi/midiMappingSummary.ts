import type { TimelineMarker } from '../../stores/timeline/types';
import {
  formatMIDINoteBinding,
  type MarkerMIDIAction,
  type MIDISlotAction,
  type MIDINoteBinding,
  type MIDITransportAction,
} from '../../types/midi';

export interface MIDIMappingSummaryEntry {
  id: string;
  scope: 'transport' | 'marker' | 'slot';
  action: MIDITransportAction | MarkerMIDIAction | MIDISlotAction;
  actionLabel: string;
  targetLabel: string;
  behaviorLabel: string;
  binding: MIDINoteBinding;
  bindingLabel: string;
  markerId?: string;
  markerTime?: number;
  slotIndex?: number;
}

type MIDITransportBindings = Record<MIDITransportAction, MIDINoteBinding | null>;
type MIDISlotBindings = Record<number, MIDINoteBinding | null>;

export interface MIDISlotTarget {
  slotIndex: number;
  label: string;
  compositionName?: string;
}

export function formatMarkerTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getTransportActionLabel(action: MIDITransportAction): string {
  return action === 'playPause' ? 'Play / Pause' : 'Stop';
}

function getTransportBehaviorLabel(action: MIDITransportAction): string {
  return action === 'playPause'
    ? 'Toggle timeline playback'
    : 'Stop playback and return to the start';
}

function getMarkerActionLabel(action: MarkerMIDIAction): string {
  if (action === 'playFromMarker') {
    return 'Play From Marker';
  }

  if (action === 'jumpToMarkerAndStop') {
    return 'Jump To Marker And Stop';
  }

  return 'Jump To Marker';
}

function getMarkerBehaviorLabel(action: MarkerMIDIAction): string {
  if (action === 'playFromMarker') {
    return 'Move the playhead to the marker time and start playback';
  }

  if (action === 'jumpToMarkerAndStop') {
    return 'Move the playhead to the marker time and stop playback';
  }

  return 'Move the playhead to the marker time and keep the current playback state';
}

export function getSlotGridLabel(slotIndex: number): string {
  const safeSlotIndex = Math.max(0, Math.floor(slotIndex));
  const row = Math.floor(safeSlotIndex / 12);
  const col = safeSlotIndex % 12;
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

function getSlotTargetLabel(slotIndex: number, slotTargets: MIDISlotTarget[]): string {
  const target = slotTargets.find((candidate) => candidate.slotIndex === slotIndex);
  const label = target?.label ?? getSlotGridLabel(slotIndex);
  return target?.compositionName ? `${label} - ${target.compositionName}` : label;
}

export function getMarkerTargetLabel(marker: TimelineMarker): string {
  const label = marker.label.trim() || 'Marker';
  return `${label} at ${formatMarkerTime(marker.time)}`;
}

export function collectMIDIMappingSummary(
  transportBindings: MIDITransportBindings,
  markers: TimelineMarker[],
  slotBindings: MIDISlotBindings = {},
  slotTargets: MIDISlotTarget[] = []
): MIDIMappingSummaryEntry[] {
  const transportEntries: MIDIMappingSummaryEntry[] = (Object.entries(transportBindings) as Array<[
    MIDITransportAction,
    MIDINoteBinding | null,
  ]>)
    .flatMap(([action, binding]) => (binding ? [{
      id: `transport-${action}-${binding.channel}-${binding.note}`,
      scope: 'transport',
      action,
      actionLabel: getTransportActionLabel(action),
      targetLabel: 'Global Transport',
      behaviorLabel: getTransportBehaviorLabel(action),
      binding,
      bindingLabel: formatMIDINoteBinding(binding),
    }] : []));

  const markerEntries: MIDIMappingSummaryEntry[] = markers.flatMap((marker) => (
    (marker.midiBindings ?? []).map((binding) => ({
      id: `marker-${marker.id}-${binding.action}-${binding.channel}-${binding.note}`,
      scope: 'marker' as const,
      action: binding.action,
      actionLabel: getMarkerActionLabel(binding.action),
      targetLabel: getMarkerTargetLabel(marker),
      behaviorLabel: getMarkerBehaviorLabel(binding.action),
      binding,
      bindingLabel: formatMIDINoteBinding(binding),
      markerId: marker.id,
      markerTime: marker.time,
    }))
  ));

  const slotEntries: MIDIMappingSummaryEntry[] = Object.entries(slotBindings)
    .flatMap(([slotKey, binding]) => {
      if (!binding) {
        return [];
      }

      const slotIndex = Number(slotKey);
      return [{
        id: `slot-${slotIndex}-${binding.channel}-${binding.note}`,
        scope: 'slot' as const,
        action: 'triggerSlot' as const,
        actionLabel: 'Trigger Slot',
        targetLabel: getSlotTargetLabel(slotIndex, slotTargets),
        behaviorLabel: 'Trigger this slot on its layer',
        binding,
        bindingLabel: formatMIDINoteBinding(binding),
        slotIndex,
      }];
    });

  return [...transportEntries, ...markerEntries, ...slotEntries].sort((left, right) => {
    if (left.binding.channel !== right.binding.channel) {
      return left.binding.channel - right.binding.channel;
    }

    if (left.binding.note !== right.binding.note) {
      return left.binding.note - right.binding.note;
    }

    if (left.scope !== right.scope) {
      return left.scope.localeCompare(right.scope);
    }

    return left.actionLabel.localeCompare(right.actionLabel);
  });
}
