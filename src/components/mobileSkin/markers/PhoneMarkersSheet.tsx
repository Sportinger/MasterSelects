// 'markers' sheet (root): add a marker at the playhead with a label and a colour, list every marker,
// tap one to jump there, and under "More" rename, recolour, move it to the playhead, pause playback
// there, or delete it. Edits apply live through the editor's own marker actions inside ONE owned
// edit session: Done keeps them as one undo step, Cancel rolls them back (jumping is navigation).
// Ruler lanes, MIDI bindings and timeline annotations stay visible but greyed.

import { useState } from 'react';

import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineMarker } from '../../../stores/timeline/types';
import { PHONE_FULL_EDITOR_HINT, type PhoneSheetComponent } from '../contracts';
import { ProButton, ProMessage, ProSection, ProTextField } from '../compositions/phoneProControls';
import { blurAfterPointer } from '../compositions/phoneProFocus';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneGreyedOption, PhoneSwitch } from '../transition/phoneChoiceControls';
import { PHONE_MARKER_COLORS, formatPhoneMarkerTime } from './phoneMarkerFormat';
import { PHONE_MARKERS_TEST_IDS as IDS } from './phoneMarkersTestIds';
import './PhoneMarkersSheet.css';

const LANES_REASON = `Ruler lanes, MIDI-triggered markers and timeline annotations are not on the phone yet. ${PHONE_FULL_EDITOR_HINT}`;

function Swatches({ value, onPick, testId, label }: { value: string; onPick: (color: string) => void; testId: string; label: string }) {
  return (
    <div className="phone-pro-chips" role="group" aria-label={label}>
      {PHONE_MARKER_COLORS.map((color, index) => (
        <button
          key={color}
          type="button"
          className="phone-markers__swatch"
          aria-label={`Colour ${index + 1}`}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
          data-testid={`${testId}-${index}`}
          style={{ background: color }}
          onPointerUp={blurAfterPointer}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

export const PhoneMarkersSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Markers');
  const markers = useTimelineStore((state) => state.markers);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const fps = getActiveCompositionFrameRate();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string>(PHONE_MARKER_COLORS[0]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (apply: (store: ReturnType<typeof useTimelineStore.getState>) => void) => {
    setMessage(null);
    void session.apply(() => apply(useTimelineStore.getState()));
  };

  const add = () => {
    const time = useTimelineStore.getState().playheadPosition;
    const text = label.trim().slice(0, 120);
    void session.apply(() => {
      const store = useTimelineStore.getState();
      const id = store.addMarker(time, text, color);
      const added = useTimelineStore.getState().markers.find((marker) => marker.id === id);
      // The editor clamps a marker into the composition; say so instead of moving it silently.
      setMessage(added && Math.abs(added.time - time) > 1e-6
        ? `The playhead is past the end; the marker sits at the end (${formatPhoneMarkerTime(added.time, fps)}).`
        : `Marker added at ${formatPhoneMarkerTime(time, fps)}.`);
    });
    setLabel('');
  };

  const jump = (marker: TimelineMarker) => {
    const store = useTimelineStore.getState();
    if (store.isPlaying) store.pause();
    store.setPlayheadPosition(marker.time);
  };

  const expand = (marker: TimelineMarker) => {
    setRenameValue(marker.label);
    setExpandedId(expandedId === marker.id ? null : marker.id);
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  return (
    <PhoneSheet title="Markers" height="tall" onCancel={cancel} onDone={() => void done()} doneDisabled={busy}>
      <div className="phone-markers">
        <ProSection title="New marker">
          <ProTextField label="Label (optional)" value={label} testId={IDS.labelInput} placeholder="Chorus, beat, cue…" onChange={setLabel} onSubmit={add} />
          <Swatches value={color} onPick={setColor} testId={IDS.color} label="Marker colour" />
          <ProButton label={`Add at ${formatPhoneMarkerTime(playhead, fps)}`} tone="primary" testId={IDS.add} onPress={add} />
        </ProSection>
        <ProMessage text={message} testId={IDS.message} />
        <ProSection title={`Markers (${markers.length})`}>
          {markers.length === 0 ? (
            <p className="phone-markers__empty" data-testid={IDS.empty}>No markers yet. Move the playhead, then Add.</p>
          ) : (
            <ul className="phone-pro-list" data-testid={IDS.list}>
              {markers.map((marker) => {
                const expanded = expandedId === marker.id;
                return (
                  <li key={marker.id} className="phone-pro-row phone-markers__row" data-testid={IDS.row} data-marker-id={marker.id} data-time={marker.time} data-color={marker.color} style={{ borderLeftColor: marker.color }}>
                    <div className="phone-pro-row__main">
                      <button
                        type="button"
                        className="phone-pro-row__title"
                        aria-label={`Jump to ${marker.label || 'marker'} at ${formatPhoneMarkerTime(marker.time, fps)}`}
                        data-testid={IDS.jump}
                        onPointerUp={blurAfterPointer}
                        onClick={() => jump(marker)}
                      >
                        <span className="phone-pro-row__name">{marker.label || 'Marker'}</span>
                        <span className="phone-pro-row__meta">{formatPhoneMarkerTime(marker.time, fps)}{marker.stopPlayback ? ' · pauses' : ''}</span>
                      </button>
                      <ProButton compact label="More" ariaLabel={`More for ${marker.label || 'marker'}`} pressed={expanded} testId={IDS.more} onPress={() => expand(marker)} />
                    </div>
                    {expanded ? (
                      <div className="phone-markers__more">
                        <div className="phone-markers__rename">
                          <ProTextField label="Label" value={renameValue} testId={IDS.renameInput} onChange={setRenameValue} onSubmit={() => change((store) => store.updateMarker(marker.id, { label: renameValue.trim().slice(0, 120) }))} />
                          <ProButton label="Rename" testId={IDS.renameApply} onPress={() => change((store) => store.updateMarker(marker.id, { label: renameValue.trim().slice(0, 120) }))} />
                        </div>
                        <Swatches value={marker.color} onPick={(next) => change((store) => store.updateMarker(marker.id, { color: next }))} testId={IDS.rowColor} label="Marker colour" />
                        <PhoneSwitch
                          label="Pause playback here"
                          checked={Boolean(marker.stopPlayback)}
                          testId={IDS.pause}
                          onChange={(checked) => change((store) => store.updateMarker(marker.id, { stopPlayback: checked || undefined }))}
                        />
                        <div className="phone-pro-row__actions">
                          <ProButton compact label="Move to playhead" testId={IDS.moveHere} onPress={() => change((store) => store.moveMarker(marker.id, store.playheadPosition))} />
                          <ProButton compact label="Delete" tone="danger" testId={IDS.remove} onPress={() => { change((store) => store.removeMarker(marker.id)); setExpandedId(null); }} />
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </ProSection>
        <PhoneGreyedOption label="Ruler lanes, MIDI markers, annotations" reason={LANES_REASON} testId={IDS.lanes} />
      </div>
    </PhoneSheet>
  );
};
