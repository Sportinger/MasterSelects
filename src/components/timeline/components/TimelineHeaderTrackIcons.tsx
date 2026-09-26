import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconVolume2,
} from '@tabler/icons-react';

type TrackHeaderIconName = 'speaker' | 'lock' | 'unlock' | 'eye' | 'eyeOff';

export function TrackHeaderIcon({ name }: { name: TrackHeaderIconName }) {
  if (name === 'speaker') {
    return <IconVolume2 className="track-header-icon" aria-hidden="true" focusable="false" />;
  }

  if (name === 'lock') {
    return <IconLock className="track-header-icon" aria-hidden="true" focusable="false" />;
  }

  if (name === 'unlock') {
    return <IconLockOpen className="track-header-icon" aria-hidden="true" focusable="false" />;
  }

  return name === 'eyeOff'
    ? <IconEyeOff className="track-header-icon" aria-hidden="true" focusable="false" />
    : <IconEye className="track-header-icon" aria-hidden="true" focusable="false" />;
}

// Track-type identifier glyphs shown above the name on mixer tracks, so audio vs
// MIDI is recognizable at a glance (Cubase-style): a waveform for audio, and
// piano-roll note bars for MIDI.
export function MidiTrackTypeIcon() {
  return (
    <svg
      className="track-type-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="2.6" width="6.5" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="6" y="6.7" width="9" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="2.5" y="10.8" width="5.5" height="2.6" rx="1.3" fill="currentColor" />
    </svg>
  );
}

export function ScoreTrackTypeIcon() {
  // Beamed eighth-note pair, standing in for notation until the scorewriter lands.
  return (
    <svg
      className="track-type-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.1 2.2 L14.1 1 L14.1 3.4 L5.1 4.6 Z" fill="currentColor" />
      <rect x="5.1" y="3.1" width="1" height="8.8" fill="currentColor" />
      <rect x="13.1" y="2.1" width="1" height="8.8" fill="currentColor" />
      <ellipse cx="3.9" cy="11.9" rx="2.1" ry="1.6" fill="currentColor" />
      <ellipse cx="11.9" cy="10.9" rx="2.1" ry="1.6" fill="currentColor" />
    </svg>
  );
}

export function AudioTrackTypeIcon() {
  // Symmetric waveform bars mirrored around the vertical center.
  const bars = [3, 6, 11, 7, 13, 5, 9, 4];
  return (
    <svg
      className="track-type-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((h, i) => (
        <rect
          key={i}
          x={1 + i * 1.85}
          y={(16 - h) / 2}
          width="1.1"
          height={h}
          rx="0.55"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
