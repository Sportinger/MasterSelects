export type MIDITransportAction = 'playPause' | 'stop';

export type MarkerMIDIAction = 'playFromMarker' | 'jumpToMarker' | 'jumpToMarkerAndStop';

export interface MIDIDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MIDINoteBinding {
  channel: number;
  note: number;
}

export interface MarkerMIDIBinding extends MIDINoteBinding {
  action: MarkerMIDIAction;
}

export interface MIDILastMessage {
  channel: number;
  type: 'note-on' | 'note-off' | 'control-change';
  note?: number;
  noteName?: string;
  velocity?: number;
  control?: number;
  value?: number;
}

export type MIDILearnTarget =
  | {
      kind: 'transport';
      action: MIDITransportAction;
    }
  | {
      kind: 'marker';
      markerId: string;
      markerLabel: string;
      action: MarkerMIDIAction;
      sourceMarkerId?: string;
    };

export type MIDIPermissionState = PermissionState | 'unknown' | 'unsupported';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function getMIDINoteName(note: number): string {
  if (!Number.isFinite(note)) {
    return 'Unknown';
  }

  const normalizedNote = Math.max(0, Math.min(127, Math.round(note)));
  const octave = Math.floor(normalizedNote / 12) - 1;
  const noteName = NOTE_NAMES[normalizedNote % 12];
  return `${noteName}${octave}`;
}

export function formatMIDINoteBinding(binding: MIDINoteBinding | null | undefined): string {
  if (!binding) {
    return 'Unbound';
  }

  return `Ch ${binding.channel} / ${getMIDINoteName(binding.note)} (${binding.note})`;
}

export function describeMIDILearnTarget(target: MIDILearnTarget | null): string | null {
  if (!target) {
    return null;
  }

  if (target.kind === 'transport') {
    return target.action === 'playPause'
      ? 'Waiting for a note for Play/Pause'
      : 'Waiting for a note for Stop';
  }

  const markerLabel = target.markerLabel || 'Marker';
  if (target.action === 'playFromMarker') {
    return `Waiting for a note for "${markerLabel}" -> Play From Marker`;
  }

  if (target.action === 'jumpToMarkerAndStop') {
    return `Waiting for a note for "${markerLabel}" -> Jump To Marker And Stop`;
  }

  return `Waiting for a note for "${markerLabel}" -> Jump To Marker`;
}

export function describeMIDIPermissionState(state: MIDIPermissionState | null): string | null {
  switch (state) {
    case 'granted':
      return 'Browser MIDI permission granted.';
    case 'prompt':
      return 'Browser can ask for MIDI permission.';
    case 'denied':
      return 'Browser MIDI permission is blocked for this site.';
    case 'unsupported':
      return 'Web MIDI API is not supported in this browser.';
    case 'unknown':
      return 'Browser MIDI permission state is unavailable.';
    default:
      return null;
  }
}

export function getMIDIPermissionHelpText(state: MIDIPermissionState | null): string | null {
  switch (state) {
    case 'prompt':
      return 'Click Enable MIDI to trigger the browser permission prompt. Once access is granted, connected devices appear in the Devices list.';
    case 'denied':
      return 'No new dialog will appear while the browser keeps MIDI blocked for this site. Use the site info icon next to the address bar, open Site settings, and allow MIDI for localhost.';
    case 'granted':
      return 'Browser access is granted. If your controller is plugged in and powered on, it should appear below automatically.';
    case 'unknown':
      return 'This browser does not expose MIDI permission state. If no dialog appears, check the site permissions in the address bar and allow MIDI access.';
    default:
      return null;
  }
}

export function midiBindingsMatch(a: MIDINoteBinding, b: MIDINoteBinding): boolean {
  return a.channel === b.channel && a.note === b.note;
}
