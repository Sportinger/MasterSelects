// Tempo tab of the Timeline sheet: the project tempo and meter, tempo changes at the playhead (jump
// or ramp, removable) through the editor's tempo actions (MIDI moves with the tempo, media keeps its
// source time: the editor's tempoSlice decides that), and the metronome (on/off, level, beats or
// bars) that the editor's metronome scheduler plays while the transport runs.
// Tempo edits run inside the sheet's edit session (`change`); metronome settings are preferences.

import { useMemo } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { secondsToBarBeat } from '../../../timeline/tempo/TempoMap';
import { MAX_EDITABLE_TEMPO_BPM, MIN_EDITABLE_TEMPO_BPM, normalizeTempoMap, tempoEventAt } from '../../../timeline/tempo/tempoEdits';
import { ProButton, ProSection, ProStepper } from '../compositions/phoneProControls';
import { PhoneChoice, PhoneSwitch } from '../transition/phoneChoiceControls';
import { formatPhoneRangeTime } from './phoneTimelinePrefs';
import { PHONE_TIMELINE_TOOLS_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';

type Store = ReturnType<typeof useTimelineStore.getState>;

const BPM_STEPS = [
  { label: '−10', delta: -10 }, { label: '−1', delta: -1 }, { label: '+1', delta: 1 }, { label: '+10', delta: 10 },
] as const;
const VOLUME_STEPS = [{ label: '−10%', delta: -0.1 }, { label: '+10%', delta: 0.1 }] as const;
const METERS = [
  { label: '2/4', numerator: 2, denominator: 4 }, { label: '3/4', numerator: 3, denominator: 4 },
  { label: '4/4', numerator: 4, denominator: 4 }, { label: '5/4', numerator: 5, denominator: 4 },
  { label: '6/8', numerator: 6, denominator: 8 }, { label: '7/8', numerator: 7, denominator: 8 },
] as const;

function clampBpm(bpm: number): number {
  return Math.min(MAX_EDITABLE_TEMPO_BPM, Math.max(MIN_EDITABLE_TEMPO_BPM, Math.round(bpm)));
}

export interface PhoneTempoTabProps {
  fps: number;
  change: (apply: (store: Store) => void) => void;
  report: (message: string) => void;
}

export function PhoneTimelineTempoTab({ fps, change, report }: PhoneTempoTabProps) {
  const rawMap = useTimelineStore((state) => state.tempoMap);
  const map = useMemo(() => normalizeTempoMap(rawMap), [rawMap]);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const metronome = useTimelineStore((state) => state.metronomeEnabled);
  const volume = useTimelineStore((state) => state.metronomeVolume);
  const mode = useTimelineStore((state) => state.metronomeMode);
  const project = map.events[0];
  const changes = map.events.slice(1);
  const position = secondsToBarBeat(map, playhead);

  const setBpm = (eventId: string, current: number, delta: number) => {
    if (clampBpm(current + delta) === current) { report(`The tempo stays between ${MIN_EDITABLE_TEMPO_BPM} and ${MAX_EDITABLE_TEMPO_BPM} BPM.`); return; }
    change((store) => {
      // Read the value inside the session: quick taps queue up and each must see the last result.
      const fresh = normalizeTempoMap(store.tempoMap).events.find((event) => event.id === eventId)?.bpm ?? current;
      const next = clampBpm(fresh + delta);
      if (eventId === project.id) store.setProjectTempo(next);
      else store.updateTempoChange(eventId, { bpm: next });
    });
  };

  const addAtPlayhead = () => {
    const time = useTimelineStore.getState().playheadPosition;
    if (time <= 1e-6) { report('The project tempo already starts at 0: move the playhead to where the tempo changes.'); return; }
    const current = tempoEventAt(map, time);
    change((store) => {
      store.addTempoChange(time, current.bpm, { numerator: current.numerator, denominator: current.denominator });
    });
    report(`Tempo change added at ${formatPhoneRangeTime(time, fps)}.`);
  };

  return (
    <>
      <ProSection title="Project tempo">
        <ProStepper label="Tempo" value={`${project.bpm} BPM`} steps={BPM_STEPS} testId={IDS.tempoBpm}
          onStep={(delta) => setBpm(project.id, project.bpm, delta)} />
        <div className="phone-pro-chips" role="group" aria-label="Time signature">
          {METERS.map((meter) => (
            <PhoneChoice
              key={meter.label}
              label={meter.label}
              selected={project.numerator === meter.numerator && project.denominator === meter.denominator}
              testId={`${IDS.tempoMeter}-${meter.numerator}-${meter.denominator}`}
              onSelect={() => change((store) => store.updateTempoChange(project.id, { numerator: meter.numerator, denominator: meter.denominator }))}
            />
          ))}
        </div>
        <p className="phone-tltools__summary" data-testid={IDS.tempoPosition} data-bar={position.bar} data-beat={position.beat}>
          Playhead at bar {position.bar}, beat {Math.floor(position.beat)}.
        </p>
      </ProSection>
      <ProSection title={`Tempo changes (${changes.length})`}>
        <ProButton label={`Add change at ${formatPhoneRangeTime(playhead, fps)}`} tone="primary" testId={IDS.tempoAdd} onPress={addAtPlayhead} />
        {changes.length > 0 ? (
          <ul className="phone-pro-list">
            {changes.map((event) => {
              const at = secondsToBarBeat(map, event.time);
              return (
                <li key={event.id} className="phone-pro-row" data-testid={IDS.tempoRow} data-event-id={event.id} data-time={event.time} data-bpm={event.bpm} data-curve={event.curve ?? 'jump'}>
                  <span className="phone-pro-row__meta">
                    {formatPhoneRangeTime(event.time, fps)} · bar {at.bar} · {event.numerator}/{event.denominator}
                  </span>
                  <ProStepper label="Tempo" value={`${event.bpm} BPM`} steps={BPM_STEPS} testId={IDS.tempoRowBpm}
                    onStep={(delta) => setBpm(event.id, event.bpm, delta)} />
                  <PhoneSwitch label="Ramp from the previous tempo" hint="Off jumps at this point." checked={event.curve === 'ramp'} testId={IDS.tempoRowRamp}
                    onChange={(checked) => change((store) => store.updateTempoChange(event.id, { curve: checked ? 'ramp' : 'jump' }))} />
                  <ProButton compact label="Remove" tone="danger" testId={IDS.tempoRowRemove}
                    onPress={() => change((store) => store.removeTempoChange(event.id))} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </ProSection>
      <ProSection title="Metronome">
        <PhoneSwitch label="Metronome" hint="Clicks on the beats while playing; never in the export." checked={metronome} testId={IDS.metronomeSwitch}
          onChange={() => useTimelineStore.getState().toggleMetronome()} />
        <ProStepper label="Level" value={`${Math.round(volume * 100)}%`} steps={VOLUME_STEPS} testId={IDS.metronomeVolume}
          onStep={(delta) => useTimelineStore.getState().setMetronomeVolume(Math.round((volume + delta) * 10) / 10)} />
        <div className="phone-pro-chips" role="group" aria-label="Metronome clicks">
          <PhoneChoice label="Every beat" selected={mode === 'beats'} testId={`${IDS.metronomeMode}-beats`}
            onSelect={() => useTimelineStore.getState().setMetronomeMode('beats')} />
          <PhoneChoice label="Bars only" selected={mode === 'bars'} testId={`${IDS.metronomeMode}-bars`}
            onSelect={() => useTimelineStore.getState().setMetronomeMode('bars')} />
        </div>
      </ProSection>
    </>
  );
}
