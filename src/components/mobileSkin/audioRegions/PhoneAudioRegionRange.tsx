// Range controls under the waveform: Select / Move mode, start and end as typed seconds (from the
// clip start), All and Clear, and the channel the range edits apply to.

import { useEffect, useState } from 'react';

import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types/timeline';
import { blurAfterPointer, parsePhoneDecimal } from '../audio/PhoneAudioControls';
import type { PhoneRegionMode } from './PhoneAudioRegionWaveform';
import {
  formatPhoneRegionTime, phoneRegionAll, phoneRegionFromTimes, type PhoneRegionChannel,
} from './phoneAudioRegionModel';
import { PHONE_AUDIO_REGION_TEST_IDS as IDS } from './phoneAudioRegionTestIds';
import { PhoneChipRow } from '../transition/phoneSheetPrimitives';

interface Props {
  clip: TimelineClip;
  selection: TimelineAudioRegionSelection | null;
  mode: PhoneRegionMode;
  channel: PhoneRegionChannel;
  disabled: boolean;
  onDisabledTap: () => void;
  onMode: (mode: PhoneRegionMode) => void;
  onChannel: (channel: PhoneRegionChannel) => void;
  onRange: (selection: TimelineAudioRegionSelection | null) => void;
}

const MODES: readonly { id: PhoneRegionMode; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'move', label: 'Move range' },
];
const CHANNELS: readonly { id: PhoneRegionChannel; label: string }[] = [
  { id: 'both', label: 'Both channels' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

function SecondsField({ testId, label, value, max, disabled, onDisabledTap, onCommit }: {
  testId: string; label: string; value: number | null; max: number; disabled: boolean; onDisabledTap: () => void; onCommit: (value: number) => void;
}) {
  const shown = value === null ? '' : value.toFixed(3);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(shown); }, [editing, shown]);
  const commit = () => {
    setEditing(false);
    const parsed = parsePhoneDecimal(draft);
    if (Number.isFinite(parsed)) onCommit(Math.max(0, Math.min(max, parsed)));
    else setDraft(shown);
  };
  return (
    <label className="phone-region-field">
      <span>{label}</span>
      <input
        className="phone-audio-row__field" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
        value={draft} readOnly={disabled} aria-disabled={disabled || undefined} data-testid={testId}
        onFocus={() => { if (disabled) onDisabledTap(); else setEditing(true); }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      />
      <span className="phone-audio-row__suffix" aria-hidden="true">s</span>
    </label>
  );
}

export function PhoneAudioRegionRange({ clip, selection, mode, channel, disabled, onDisabledTap, onMode, onChannel, onRange }: Props) {
  const startOffset = selection ? selection.startTime - clip.startTime : null;
  const endOffset = selection ? selection.endTime - clip.startTime : null;
  const length = clip.duration;

  const setStart = (value: number) => onRange(phoneRegionFromTimes(clip, clip.startTime + value, clip.startTime + (endOffset ?? length)));
  const setEnd = (value: number) => onRange(phoneRegionFromTimes(clip, clip.startTime + (startOffset ?? 0), clip.startTime + value));

  const chip = (testId: string, checked: boolean, label: string, onTap: () => void) => (
    <button key={testId} type="button" role="radio" aria-checked={checked} className="phone-audio-beats__chip" data-testid={testId}
      onPointerUp={blurAfterPointer} onClick={onTap}>
      {label}
    </button>
  );

  return (
    <div className="phone-region-range">
      <PhoneChipRow role="radiogroup" label="Waveform gesture">
        {MODES.map((item) => chip(`${IDS.modePrefix}${item.id}`, mode === item.id, item.label, () => onMode(item.id)))}
      </PhoneChipRow>
      <div className="phone-region-row">
        <SecondsField testId={IDS.startInput} label="Start" value={startOffset} max={length} disabled={disabled} onDisabledTap={onDisabledTap} onCommit={setStart} />
        <SecondsField testId={IDS.endInput} label="End" value={endOffset} max={length} disabled={disabled} onDisabledTap={onDisabledTap} onCommit={setEnd} />
      </div>
      <div className="phone-region-row">
        <button type="button" className="phone-audio-toggle" data-testid={IDS.selectAll} aria-disabled={disabled || undefined}
          onPointerUp={blurAfterPointer} onClick={() => (disabled ? onDisabledTap() : onRange(phoneRegionAll(clip)))}>
          All
        </button>
        <button type="button" className="phone-audio-toggle" data-testid={IDS.clearRange} aria-disabled={!selection || undefined}
          onPointerUp={blurAfterPointer} onClick={() => onRange(null)}>
          Clear range
        </button>
      </div>
      <PhoneChipRow role="radiogroup" label="Channels">
        {CHANNELS.map((item) => chip(`${IDS.channelPrefix}${item.id}`, channel === item.id, item.label, () => onChannel(item.id)))}
      </PhoneChipRow>
      <p className="phone-audio-sheet__hint" data-testid={IDS.readout}
        data-start={selection ? selection.startTime.toFixed(4) : ''} data-end={selection ? selection.endTime.toFixed(4) : ''}>
        {selection
          ? `Range ${formatPhoneRegionTime(selection.startTime)} – ${formatPhoneRegionTime(selection.endTime)} (${(selection.endTime - selection.startTime).toFixed(3)} s)`
          : mode === 'select' ? 'Drag across the waveform to select a range, or tap All.' : 'Select a range first; then drag it along the clip.'}
      </p>
    </div>
  );
}
