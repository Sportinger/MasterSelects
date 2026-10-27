// 'replace' sheet (clip): swap the selected video clip's footage and keep everything else: place,
// length, effects, masks, keyframes and its linked sound. Pick a new video from the phone (copied
// into the project like any import), another video of the project, or a composition. The choice
// shows in the preview right away inside ONE owned edit session: Done keeps it as one undo step,
// Cancel puts the original footage back. An imported file stays in the project's media either way.

import { useMemo, useRef, useState, type ChangeEvent } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneActionResult, PhoneSheetComponent } from '../contracts';
import { phoneUserCompositions } from '../compositions/phoneCompositionCommands';
import { ProButton, ProMessage, ProSection } from '../compositions/phoneProControls';
import { usePhoneMediaImport } from '../media/usePhoneMediaImport';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { phoneReplaceUnsupportedReason, phoneReplaceWithComposition, phoneReplaceWithMedia } from './phoneReplaceCommands';
import { PHONE_REPLACE_TEST_IDS as IDS } from './phoneReplaceTestIds';
import './PhoneReplaceSheet.css';

function initialClipId(): string | null {
  const timeline = useTimelineStore.getState();
  const primary = timeline.primarySelectedClipId;
  if (primary && timeline.selectedClipIds.has(primary)) return primary;
  return timeline.clips.find((clip) => timeline.selectedClipIds.has(clip.id))?.id ?? null;
}

export const PhoneReplaceSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Replace clip');
  const { progress, importFiles } = usePhoneMediaImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [clipId] = useState(initialClipId);
  const clip = useTimelineStore((state) => (clipId ? state.clips.find((candidate) => candidate.id === clipId) : undefined));
  const trackLocked = useTimelineStore((state) => Boolean(clip && state.tracks.find((track) => track.id === clip.trackId)?.locked));
  const files = useMediaStore((state) => state.files);
  const compositions = useMediaStore((state) => state.compositions);
  const activeId = useMediaStore((state) => state.activeCompositionId);
  const [originalMediaId] = useState(() => clip?.source?.mediaFileId ?? clip?.mediaFileId ?? null);
  const [choice, setChoice] = useState<{ kind: 'media' | 'composition'; id: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const videos = useMemo(() => files.filter((file) => file.type === 'video'), [files]);
  const standIns = useMemo(() => phoneUserCompositions(compositions).filter((composition) => composition.id !== activeId), [compositions, activeId]);

  const report = (result: PhoneActionResult) => setMessage(result.ok ? (result.message ? { text: result.message, tone: 'info' } : null) : { text: result.message, tone: 'error' });

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

  if (!clip) {
    return (
      <PhoneSheet title="Replace clip" onCancel={cancel} onDone={() => undefined} doneDisabled>
        <p className="phone-replace__note" data-testid={IDS.unsupported}>Select a video clip first, then tap Replace.</p>
      </PhoneSheet>
    );
  }

  const usesComposition = choice?.kind === 'composition';
  const unsupported = choice ? (trackLocked ? phoneReplaceUnsupportedReason(clip, trackLocked) : null) : phoneReplaceUnsupportedReason(clip, trackLocked);
  const compositionChosenReason = usesComposition ? 'The clip shows a composition now. Tap Cancel to start over with the original footage.' : null;

  const pickMedia = (mediaId: string) => {
    setChoice({ kind: 'media', id: mediaId });
    void session.apply(() => report(phoneReplaceWithMedia(clip.id, mediaId)));
  };

  const pickComposition = (compositionId: string) => {
    setChoice({ kind: 'composition', id: compositionId });
    void session.apply(async () => report(await phoneReplaceWithComposition(clip.id, compositionId)));
  };

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage(null);
    const outcome = await importFiles([file]);
    const problem = outcome.failures[0] ?? null;
    const imported = outcome.imported[0];
    if (problem || !imported) { report({ ok: false, message: problem?.message ?? `${file.name} could not be imported.` }); return; }
    if (imported.result.type !== 'video') {
      report({ ok: false, message: `${file.name} is not a video. Pick a video file.` });
      return;
    }
    pickMedia(imported.result.id);
    if (outcome.notDurable[0]) showToast(outcome.notDurable[0].message, 'error');
  };

  return (
    <PhoneSheet title="Replace clip" height="tall" onCancel={cancel} onDone={() => void done()} doneDisabled={busy || progress !== null}>
      <div className="phone-replace">
        <p className="phone-replace__note" data-testid={IDS.status}>
          {clip.name}: the new footage keeps this clip's place, length, effects and keyframes.
        </p>
        {unsupported ? <p className="phone-replace__note phone-replace__note--warn" data-testid={IDS.unsupported}>{unsupported}</p> : null}
        <ProButton
          label={progress ? `Importing ${progress.name}…` : 'Pick a video from this phone'}
          tone="primary"
          testId={IDS.pickDevice}
          unavailableReason={unsupported ?? compositionChosenReason ?? (progress ? 'An import is running.' : null)}
          onPress={() => inputRef.current?.click()}
        />
        <input ref={inputRef} type="file" accept="video/*" hidden tabIndex={-1} data-testid={IDS.input} onChange={(event) => void onFileChosen(event)} />
        {progress ? <p className="phone-replace__note" role="status" data-testid={IDS.progress}>Copying {progress.name} into the project…</p> : null}
        <ProMessage text={message?.text ?? null} tone={message?.tone ?? 'info'} testId={IDS.message} />
        <ProSection title={`Videos in this project (${videos.length})`}>
          {videos.length === 0 ? <p className="phone-replace__note">No videos yet: pick one from the phone.</p> : null}
          <div className="phone-replace__grid">
            {videos.map((file) => (
              <ProButton
                key={file.id}
                label={file.name}
                ariaLabel={`Use ${file.name}${file.id === originalMediaId ? ' (original)' : ''}`}
                pressed={choice ? choice.kind === 'media' && choice.id === file.id : file.id === originalMediaId}
                testId={IDS.media}
                data={{ 'media-id': file.id }}
                unavailableReason={unsupported ?? compositionChosenReason}
                onPress={() => pickMedia(file.id)}
              >
                <span className="phone-replace__name">{file.name}</span>
                {file.id === originalMediaId ? <span className="phone-replace__tag">Original</span> : null}
              </ProButton>
            ))}
          </div>
        </ProSection>
        <ProSection title="A composition instead">
          {standIns.length === 0 ? <p className="phone-replace__note">No other composition in this project.</p> : null}
          <div className="phone-replace__grid">
            {standIns.map((composition) => (
              <ProButton
                key={composition.id}
                label={composition.name}
                pressed={choice?.kind === 'composition' && choice.id === composition.id}
                testId={IDS.composition}
                data={{ 'composition-id': composition.id }}
                unavailableReason={unsupported ?? (usesComposition && choice?.id !== composition.id ? compositionChosenReason : null)}
                onPress={() => pickComposition(composition.id)}
              />
            ))}
          </div>
        </ProSection>
      </div>
    </PhoneSheet>
  );
};
