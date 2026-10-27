// 'overlay' sheet (nothing selected): add a photo or video from the phone as a picture in picture
// at the playhead, on a free video track above the main picture, scaled down and placed where you
// choose; it is selected afterwards. The import is the media sheet's (copied into the project) and
// placement is the media sheet's overlay mode; import, placement and the PIP transform are ONE undo
// step. The sheet also lists the overlays under the playhead: tap one to select it.

import { useMemo, useRef, useState, type ChangeEvent } from 'react';

import { Logger } from '../../../services/logger';
import { runEditorBatch } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { usePhoneMediaImport } from '../media/usePhoneMediaImport';
import { placePhoneMedia } from '../media/phoneMediaPlacement';
import { getPhoneActiveCompSize, getPhoneClipSourceSize } from '../crop/phoneClipTarget';
import { blurAfterPointer, PhoneChipGroup, PhoneSheetNote } from '../crop/phoneDesignControls';
import {
  listPhoneOverlaysAtPlayhead, PHONE_OVERLAY_PLACES, PHONE_OVERLAY_SIZES, phoneOverlayTransform,
  type PhoneOverlayPlace, type PhoneOverlaySize,
} from './phoneOverlayPlan';
import { PHONE_OVERLAY_TEST_IDS as IDS } from './phoneOverlayTestIds';

const log = Logger.create('PhoneOverlaySheet');
const ACCEPT = 'image/*,video/*';

/** Applies the PIP transform to each placed visual clip; runs inside the caller's batch. */
function shrinkToPictureInPicture(clipIds: readonly string[], size: PhoneOverlaySize, place: PhoneOverlayPlace): void {
  const comp = getPhoneActiveCompSize();
  for (const clipId of clipIds) {
    const state = useTimelineStore.getState();
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip || state.tracks.find((track) => track.id === clip.trackId)?.type !== 'video') continue;
    const pip = phoneOverlayTransform(size, place, getPhoneClipSourceSize(clip), comp);
    state.setPropertyValue(clipId, 'scale.all', pip.scale);
    state.setPropertyValue(clipId, 'position.x', pip.x);
    state.setPropertyValue(clipId, 'position.y', pip.y);
  }
}

export const PhoneOverlaySheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const { progress, importFiles } = usePhoneMediaImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [size, setSize] = useState<PhoneOverlaySize>('medium');
  const [place, setPlace] = useState<PhoneOverlayPlace>('center');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tracks = useTimelineStore((state) => state.tracks);
  const clips = useTimelineStore((state) => state.clips);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const existing = useMemo(() => listPhoneOverlaysAtPlayhead(tracks, clips, playhead), [tracks, clips, playhead]);

  const onChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (file) {
      setPicked(file);
      setProblem(null);
    }
  };

  const cancel = () => {
    if (busy) {
      showToast('Adding the overlay is in progress. Wait until it finishes.');
      return;
    }
    closeSheet();
  };

  const add = async () => {
    if (busy || !picked) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await runEditorBatch('Add overlay', async () => {
        const imported = await importFiles([picked]);
        const placement = await placePhoneMedia(imported.imported, 'overlay');
        shrinkToPictureInPicture(placement.clipIds, size, place);
        const last = placement.clipIds.at(-1);
        if (last) useTimelineStore.getState().selectClip(last);
        return { problems: [...imported.failures, ...placement.failures, ...imported.notDurable], placed: placement.clipIds.length };
      });
      if (outcome.placed > 0 && outcome.problems.length === 0) {
        showToast('Overlay added.');
        closeSheet();
        return;
      }
      const message = outcome.problems[0]?.message ?? 'The overlay could not be added.';
      if (outcome.placed > 0) {
        showToast(`Overlay added. ${message}`, 'error');
        closeSheet();
        return;
      }
      setProblem(message);
      showToast(message, 'error');
    } catch (error) {
      log.error('Adding the overlay failed', error);
      const message = `Adding the overlay failed: ${error instanceof Error ? error.message : String(error)}`;
      setProblem(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const selectExisting = (clipId: string) => {
    if (busy) return;
    useTimelineStore.getState().selectClip(clipId);
    closeSheet();
  };

  return (
    <PhoneSheet title="Overlay" height="tall" onCancel={cancel} onDone={() => { void add(); }}
      doneLabel={busy ? 'Adding…' : 'Add'} doneDisabled={busy || !picked}>
      <div className="phone-design-sheet" data-testid={IDS.sheet}>
        <section className="phone-design-section">
          <h3 className="phone-design-section__title">New overlay at the playhead</h3>
          <div className="phone-design-row">
            <button type="button" className="phone-design-chip phone-design-chip--action" data-testid={IDS.pick}
              aria-disabled={busy} onPointerUp={blurAfterPointer}
              onClick={() => { if (!busy) inputRef.current?.click(); }}>
              {picked ? 'Pick another' : 'Photo or video'}
            </button>
            <input ref={inputRef} type="file" accept={ACCEPT} hidden tabIndex={-1} data-testid={IDS.input} onChange={onChosen} />
          </div>
          {picked ? (
            <PhoneSheetNote testId={IDS.picked}>{picked.name}</PhoneSheetNote>
          ) : (
            <PhoneSheetNote>Pick a photo or video. It goes on a track above the main picture, copied into the project.</PhoneSheetNote>
          )}
          <PhoneChipGroup<PhoneOverlaySize> label="Overlay size" value={size} testId={IDS.size}
            options={PHONE_OVERLAY_SIZES.map(({ value, label }) => ({ value, label }))} onChange={setSize} />
          <PhoneChipGroup<PhoneOverlayPlace> label="Overlay place" value={place} testId={IDS.place}
            options={PHONE_OVERLAY_PLACES} onChange={setPlace} />
          {busy ? (
            <p className="phone-design-note" role="status" aria-live="polite" data-testid={IDS.progress}>
              {progress ? `Importing ${progress.name}…` : 'Placing the overlay…'}
            </p>
          ) : null}
          {problem ? <PhoneSheetNote tone="warn">{problem}</PhoneSheetNote> : null}
        </section>
        <section className="phone-design-section">
          <h3 className="phone-design-section__title">Overlays at the playhead</h3>
          {existing.length === 0 ? (
            <PhoneSheetNote>None here. Overlays are clips on tracks above the main picture.</PhoneSheetNote>
          ) : (
            <ul className="phone-design-list">
              {existing.map((entry) => (
                <li key={entry.clipId}>
                  <button type="button" className="phone-design-list__item" data-testid={IDS.existing} data-clip-id={entry.clipId}
                    onPointerUp={blurAfterPointer} onClick={() => selectExisting(entry.clipId)}>
                    <span className="phone-design-list__name">{entry.name}</span>
                    <span className="phone-design-list__meta">{entry.trackName} · Select</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PhoneSheet>
  );
};
