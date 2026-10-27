// 'clipDetails' sheet (clip action "Details"): the selected clip's name (renamed where the editor
// renames: MIDI clips and storyboard scenes), its source and time span, the source label colour
// (shown on every clip of that source, here and on the desktop), its parent clip (the editor keeps
// the world position, refusals such as loops are shown), a new null object as parent, and the
// parent of its track. Everything runs in ONE owned edit session: Done is one undo step, Cancel
// rolls it all back.

import { useState } from 'react';

import { LABEL_COLORS } from '../../panels/media/labelColors';
import { useMediaStore } from '../../../stores/mediaStore';
import type { LabelColor } from '../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../stores/timeline';
import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { PHONE_FULL_EDITOR_HINT, type PhoneSheetComponent } from '../contracts';
import { ProButton, ProEmptyState, ProMessage, ProSection, ProTextField } from '../compositions/phoneProControls';
import { blurAfterPointer } from '../compositions/phoneProFocus';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChoice, PhoneGreyedOption } from '../transition/phoneChoiceControls';
import {
  parentSelectionToNewNull, phoneClipLabelTarget, phoneParentCandidates, phoneParentTrackProblem, phoneRenameSupport,
  phoneTrackParentCandidates, renamePhoneClip, setPhoneClipLabelColor, setPhoneClipParent, setPhoneTrackParent,
} from './phoneClipDetailsCommands';
import { formatPhoneRangeTime } from './phoneTimelinePrefs';
import { phoneClipAtPlayhead, PHONE_NO_CLIP_AT_PLAYHEAD, selectPhoneClipAtPlayhead } from './phoneSelectAtPlayhead';
import { PHONE_CLIP_DETAILS_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';
import './PhoneTimelineTools.css';

const RENAME_REASON = `In MasterSelects only MIDI clips and storyboard scenes have their own name; every other clip shows the name of its media (rename the media in Library). ${PHONE_FULL_EDITOR_HINT}`;
const COLOR_REASON = 'This clip has no media item to colour (the label colour belongs to the source, so all its clips share it).';

type Result = { ok: boolean; message: string };

export const PhoneClipDetailsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Clip details');
  const clipId = useTimelineStore((state) => {
    const primary = state.primarySelectedClipId;
    return primary && state.selectedClipIds.has(primary) ? primary : [...state.selectedClipIds][0] ?? null;
  });
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId) ?? null);
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  // Re-render when the media item's colour changes.
  const labelColor = useMediaStore(() => phoneClipLabelTarget(clip).currentColor);
  const labelTarget = phoneClipLabelTarget(clip);
  const mediaName = useMediaStore((state) => {
    const fileId = clip?.mediaFileId ?? clip?.source?.mediaFileId;
    return fileId ? state.files.find((file) => file.id === fileId)?.name ?? null : null;
  });
  const clipAtPlayhead = useTimelineStore(() => phoneClipAtPlayhead());
  const fps = getActiveCompositionFrameRate();
  const [name, setName] = useState(clip?.name ?? '');
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Result) => {
    setMessage(null);
    void session.apply(() => {
      const result = action();
      setMessage({ text: result.message, tone: result.ok ? 'info' : 'error' });
    });
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

  if (!clip) {
    return (
      <PhoneSheet title="Details" height="tall" onCancel={cancel}>
        <div data-testid={IDS.root}>
          <ProEmptyState icon="details" title="No clip selected" body="Details shows the name, colour and parent of the selected clip."
            action={{ label: 'Select clip at playhead', testId: IDS.selectAtPlayhead, unavailableReason: clipAtPlayhead ? null : PHONE_NO_CLIP_AT_PLAYHEAD, onPress: selectPhoneClipAtPlayhead }} />
        </div>
      </PhoneSheet>
    );
  }

  const track = tracks.find((candidate) => candidate.id === clip.trackId);
  const rename = phoneRenameSupport(clip);
  const parentProblem = phoneParentTrackProblem({ clips, tracks }, clip.id);
  const candidates = phoneParentCandidates({ clips, tracks }, clip.id);
  const trackCandidates = track ? phoneTrackParentCandidates({ tracks }, track.id) : [];
  const selectedIds = [...useTimelineStore.getState().selectedClipIds];
  const sourceName = mediaName ?? clip.source?.type ?? 'unknown';

  return (
    <PhoneSheet title="Details" height="tall" onCancel={cancel} onDone={() => void done()} doneDisabled={busy}>
      <div className="phone-clipdetails" data-testid={IDS.root} data-clip-id={clip.id}>
        <ProMessage text={message?.text ?? null} tone={message?.tone} testId={IDS.message} />
        <ProSection title="Name">
          {rename ? (
            <>
              <ProTextField label={rename === 'midi' ? 'MIDI clip name' : 'Scene title'} value={name} testId={IDS.name} onChange={setName}
                onSubmit={() => run(() => renamePhoneClip(clip.id, name))} />
              <ProButton label="Rename" testId={IDS.rename} onPress={() => run(() => renamePhoneClip(clip.id, name))} />
            </>
          ) : (
            <>
              <p className="phone-tltools__summary" data-testid={IDS.name}>{clip.name}</p>
              <PhoneGreyedOption label="Rename this clip" reason={RENAME_REASON} testId={IDS.renameGreyed} />
            </>
          )}
        </ProSection>
        <ProSection title="Source and time">
          <p className="phone-tltools__summary" data-testid={IDS.source}>Source: {sourceName} · track {track?.name ?? '?'}</p>
          <p className="phone-tltools__summary" data-testid={IDS.span} data-start={clip.startTime} data-duration={clip.duration}>
            Starts {formatPhoneRangeTime(clip.startTime, fps)} · {Math.round(clip.duration * fps)} frames
            ({formatPhoneRangeTime(clip.duration, fps)}) · source {formatPhoneRangeTime(clip.inPoint, fps)}–{formatPhoneRangeTime(clip.outPoint, fps)}
          </p>
        </ProSection>
        <ProSection title="Source colour">
          {labelTarget.mediaItemId ? (
            <div className="phone-pro-chips" role="group" aria-label="Source label colour" data-color={labelColor}>
              {LABEL_COLORS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`phone-clipdetails__swatch${entry.key === 'none' ? ' phone-clipdetails__swatch--none' : ''}`}
                  aria-label={entry.name}
                  aria-pressed={labelColor === entry.key}
                  data-testid={`${IDS.color}-${entry.key}`}
                  style={entry.key === 'none' ? undefined : { background: entry.hex }}
                  onPointerUp={blurAfterPointer}
                  onClick={() => run(() => (setPhoneClipLabelColor(clip.id, entry.key as LabelColor)
                    ? { ok: true, message: `Source colour: ${entry.name}. Every clip of this source shows it.` }
                    : { ok: false, message: COLOR_REASON }))}
                />
              ))}
            </div>
          ) : (
            <PhoneGreyedOption label="Source colour" reason={COLOR_REASON} testId={IDS.colorGreyed} />
          )}
        </ProSection>
        <ProSection title="Parent clip" testId={IDS.parent}>
          <p className="phone-tltools__summary">
            A child follows its parent's position, rotation and size; parenting keeps it where it is now.
          </p>
          <div className="phone-pro-chips" role="group" aria-label="Parent clip" data-parent-id={clip.parentClipId ?? ''}>
            <PhoneChoice label="None" selected={!clip.parentClipId} testId={IDS.parentNone} unavailableReason={parentProblem}
              onSelect={() => run(() => setPhoneClipParent(clip.id, null))} />
            {candidates.map((candidate) => (
              <span key={candidate.id} data-clip-id={candidate.id} style={{ display: 'contents' }}>
                <PhoneChoice
                  label={`${candidate.name} · ${formatPhoneRangeTime(candidate.startTime, fps)}`}
                  selected={clip.parentClipId === candidate.id}
                  testId={`${IDS.parentOption}-${candidate.id}`}
                  unavailableReason={parentProblem}
                  onSelect={() => run(() => setPhoneClipParent(clip.id, candidate.id))}
                />
              </span>
            ))}
          </div>
          <ProButton
            label={selectedIds.length > 1 ? `Parent ${selectedIds.length} clips to a new null` : 'Parent to a new null'}
            testId={IDS.nullParent}
            unavailableReason={parentProblem}
            onPress={() => run(() => parentSelectionToNewNull(selectedIds))}
          />
        </ProSection>
        <ProSection title="Track parent" testId={IDS.trackParent}>
          <div className="phone-pro-chips" role="group" aria-label="Track parent" data-parent-id={track?.parentTrackId ?? ''}>
            <PhoneChoice label="None" selected={!track?.parentTrackId} testId={IDS.trackParentNone}
              unavailableReason={track ? null : 'The clip has no track.'}
              onSelect={() => track && run(() => setPhoneTrackParent(track.id, null))} />
            {trackCandidates.map((candidate) => (
              <PhoneChoice key={candidate.id} label={candidate.name} selected={track?.parentTrackId === candidate.id}
                testId={`${IDS.trackParentOption}-${candidate.id}`}
                onSelect={() => track && run(() => setPhoneTrackParent(track.id, candidate.id))} />
            ))}
          </div>
        </ProSection>
      </div>
    </PhoneSheet>
  );
};
