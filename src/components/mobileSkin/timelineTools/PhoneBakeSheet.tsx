// 'bake' sheet (clip action "Bake", Timeline → Range → Bake this range): video bake regions through
// the editor's videoBake actions. Mark the in/out range of the composition or the whole selected
// clip, then Bake (pre-render, with progress), Unbake or Remove. Like the desktop ruler and clip
// controls, every action is its own undo step at once (baking renders in the background, so there
// is no draft to cancel); the sheet only has Close. Composition baking encodes with WebCodecs: a
// browser without a video encoder sees that button greyed with the reason.

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import type { VideoBakeRegion } from '../../../types/clipMetadata';
import { PHONE_FULL_EDITOR_HINT, type PhoneSheetComponent } from '../contracts';
import { ProButton, ProMessage, ProSection } from '../compositions/phoneProControls';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneGreyedOption } from '../transition/phoneChoiceControls';
import { formatPhoneRangeTime, phoneRangeSpan } from './phoneTimelinePrefs';
import { hasPhoneVideoEncoder } from './phoneTimelineToolsModel';
import { PHONE_BAKE_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';
import './PhoneTimelineTools.css';

const ENCODER_REASON = `Baking a composition range encodes it as video, and this browser has no WebCodecs video encoder. Clip regions still bake here; the full editor on a computer bakes composition ranges. ${PHONE_FULL_EDITOR_HINT}`;

interface Row { region: VideoBakeRegion; clipId: string | null; label: string }

export const PhoneBakeSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const compositionRegions = useTimelineStore((state) => state.videoBakeRegions);
  const clips = useTimelineStore((state) => state.clips);
  const inPoint = useTimelineStore((state) => state.inPoint);
  const outPoint = useTimelineStore((state) => state.outPoint);
  const duration = useTimelineStore((state) => state.duration);
  const selectedId = useTimelineStore((state) => {
    const primary = state.primarySelectedClipId;
    return primary && state.selectedClipIds.has(primary) ? primary : [...state.selectedClipIds][0] ?? null;
  });
  const fps = getActiveCompositionFrameRate();
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const span = phoneRangeSpan(inPoint, outPoint, duration);
  const encoder = hasPhoneVideoEncoder();
  const selected = clips.find((clip) => clip.id === selectedId) ?? null;

  const rows: Row[] = [
    ...compositionRegions.map((region) => ({ region, clipId: null, label: 'Composition range' })),
    ...clips.flatMap((clip) => (clip.videoState?.bakeRegions ?? []).map((region) => ({ region, clipId: clip.id, label: clip.name }))),
  ];

  const say = (ok: boolean, text: string) => setMessage({ text, tone: ok ? 'info' : 'error' });

  const markRange = () => {
    if (!span) return;
    const id = useTimelineStore.getState().addCompositionVideoBakeRegion(span.start, span.end);
    say(Boolean(id), id ? 'Range marked. Tap Bake to pre-render it.' : 'The editor could not mark this range (it is empty).');
  };
  const markClip = () => {
    if (!selected) return;
    const id = useTimelineStore.getState().addClipVideoBakeRegion(selected.id, {
      startTime: selected.startTime, endTime: selected.startTime + selected.duration,
      sourceInPoint: selected.inPoint, sourceOutPoint: selected.outPoint,
    });
    say(Boolean(id), id ? `“${selected.name}” marked. Tap Bake to pre-render it.` : 'Only a visual clip on an unlocked video track can be baked.');
  };
  const bake = async (row: Row) => {
    const store = useTimelineStore.getState();
    say(true, 'Baking…');
    const ok = row.clipId
      ? await store.bakeClipVideoBakeRegion(row.clipId, row.region.id)
      : await store.bakeCompositionVideoBakeRegion(row.region.id);
    say(ok, ok ? 'Baked: playback uses the pre-rendered frames.' : 'Baking failed or was stopped; the region shows why.');
  };
  const unbake = (row: Row) => {
    const store = useTimelineStore.getState();
    const ok = row.clipId ? store.unbakeClipVideoBakeRegion(row.clipId, row.region.id) : store.unbakeCompositionVideoBakeRegion(row.region.id);
    say(ok, ok ? 'Unbaked: the region stays marked.' : 'The region was not baked.');
  };
  const remove = (row: Row) => {
    const store = useTimelineStore.getState();
    const ok = row.clipId ? store.removeClipVideoBakeRegion(row.clipId, row.region.id) : store.removeCompositionVideoBakeRegion(row.region.id);
    say(ok, ok ? 'Region removed.' : 'The region is already gone.');
  };

  return (
    <PhoneSheet title="Bake" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-bake" data-testid={IDS.root}>
        <ProMessage text={message?.text ?? null} tone={message?.tone} testId={IDS.message} />
        <ProSection title="Mark">
          {encoder ? (
            <ProButton
              label={span ? `Composition ${formatPhoneRangeTime(span.start, fps)}–${formatPhoneRangeTime(span.end, fps)}` : 'Composition range'}
              testId={IDS.markRange}
              unavailableReason={span ? null : 'Set In and Out first (Timeline → Range or the In/Out buttons under the timeline).'}
              onPress={markRange}
            />
          ) : (
            <PhoneGreyedOption label="Composition range" reason={ENCODER_REASON} testId={IDS.encoderGreyed} />
          )}
          <ProButton label={selected ? `Whole clip “${selected.name}”` : 'Whole clip'} testId={IDS.markClip}
            unavailableReason={selected ? null : 'Select a clip on the timeline first to mark the whole clip.'} onPress={markClip} />
        </ProSection>
        <ProSection title={`Regions (${rows.length})`}>
          {rows.length === 0 ? <p className="phone-tltools__summary" data-testid={IDS.empty}>No bake regions yet.</p> : (
            <ul className="phone-pro-list">
              {rows.map((row) => {
                const status = row.region.status ?? 'marked';
                return (
                  <li key={row.region.id} className="phone-pro-row" data-testid={IDS.row} data-region-id={row.region.id}
                    data-scope={row.region.scope} data-status={status}>
                    <span className="phone-pro-row__meta">
                      {row.label} · {formatPhoneRangeTime(row.region.startTime, fps)}–{formatPhoneRangeTime(row.region.endTime, fps)} · {status}
                      {row.region.error ? ` · ${row.region.error}` : ''}
                    </span>
                    {status === 'baking' ? (
                      <div className="phone-bake__progress" role="progressbar" aria-valuenow={Math.round(row.region.progress ?? 0)} aria-valuemin={0} aria-valuemax={100}>
                        <span style={{ width: `${Math.max(0, Math.min(100, row.region.progress ?? 0))}%` }} />
                      </div>
                    ) : null}
                    <div className="phone-pro-row__actions">
                      <ProButton compact label="Bake" tone="primary" testId={IDS.bake}
                        unavailableReason={status === 'baking' ? 'This region is baking right now.'
                          : !row.clipId && !encoder ? ENCODER_REASON : null}
                        onPress={() => void bake(row)} />
                      <ProButton compact label="Unbake" testId={IDS.unbake}
                        unavailableReason={status === 'baked' ? null : 'Only a baked region can be unbaked.'} onPress={() => unbake(row)} />
                      <ProButton compact label="Remove" tone="danger" testId={IDS.remove} onPress={() => remove(row)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ProSection>
      </div>
    </PhoneSheet>
  );
};
