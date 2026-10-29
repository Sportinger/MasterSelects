// 'media' sheet: pick photos/videos or audio/files with the native picker, review them in pick
// order, choose "append" or "overlay", then Done imports (copied into the project) and places them
// as one undo step. Picked files live only in this component's state, never in a store.

import { useRef, useState, type ChangeEvent } from 'react';
import { PHONE_M1_TEST_IDS, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { usePhoneMediaImport, type PhoneImportProblem } from './usePhoneMediaImport';
import { placePhoneMedia, type PhonePlacementMode } from './phoneMediaPlacement';
import { Logger } from '../../../services/logger';
import { formatMediaBytes } from '../../../services/project/mediaCopy/projectMediaCopyNotices';
import { runEditorBatch } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { beginMediaImportTiming } from '../../../stores/mediaStore/helpers/importPhaseTimings';
import './PhoneMediaSheet.css';

const log = Logger.create('PhoneMediaSheet');

/** Photos & videos only: a mixed audio filter can skip the photo library (see the media panel picker). */
const VISUAL_ACCEPT = 'image/*,video/*';
const AUDIO_ACCEPT = 'audio/*,video/*,image/*';

interface PickedFile {
  id: number;
  file: File;
}

type Phase = 'pick' | 'importing' | 'placing' | 'result';

let pickCounter = 0;

function kindLabel(file: File): string {
  if (file.type.startsWith('video/')) return 'Video';
  if (file.type.startsWith('image/')) return 'Photo';
  if (file.type.startsWith('audio/')) return 'Audio';
  return 'File';
}

export const PhoneMediaSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const { progress, copyNotice, importFiles } = usePhoneMediaImport();
  const visualInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [mode, setMode] = useState<PhonePlacementMode>('append');
  const [phase, setPhase] = useState<Phase>('pick');
  const [problems, setProblems] = useState<PhoneImportProblem[]>([]);
  const busy = phase === 'importing' || phase === 'placing';

  const onFilesChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    // Reset so picking the same file again still fires a change.
    event.target.value = '';
    if (files.length === 0) return;
    setPicked((current) => [...current, ...files.map((file) => ({ id: ++pickCounter, file }))]);
  };

  const remove = (id: number) => setPicked((current) => current.filter((item) => item.id !== id));

  const cancel = () => {
    if (busy) {
      showToast('Adding media is in progress. Wait until it finishes.');
      return;
    }
    closeSheet();
  };

  const commit = async () => {
    if (phase === 'result') {
      closeSheet();
      return;
    }
    if (busy || picked.length === 0) return;
    const files = picked.map((item) => item.file);
    setPhase('importing');
    setProblems([]);
    // Done to clips on the timeline, by phase (window.__MS_MEDIA_IMPORT__, kind 'phone-add').
    const timing = beginMediaImportTiming('phone-add', files.length === 1 ? files[0].type || 'unknown' : 'mixed',
      files.reduce((sum, file) => sum + file.size, 0));
    try {
      const { imported, failures, notDurable, placed } = await runEditorBatch('Add media', async () => {
        timing.mark('batch_start');
        const importOutcome = await importFiles(files);
        timing.mark('import');
        setPhase('placing');
        const placement = await placePhoneMedia(importOutcome.imported, mode);
        timing.mark('placement');
        return { ...importOutcome, placed: placement };
      });
      timing.mark('commit');
      timing.finish('ok');
      const allProblems = [...failures, ...placed.failures, ...notDurable];
      const count = placed.clipIds.length;
      log.info('Phone media added', { picked: files.length, imported: imported.length, placed: count, problems: allProblems.length });
      setPicked([]);
      if (allProblems.length === 0) {
        showToast(count === 1 ? 'Added 1 clip.' : `Added ${count} clips.`);
        closeSheet();
        return;
      }
      setProblems(allProblems);
      setPhase('result');
      showToast(`${count} of ${files.length} added. ${allProblems[0].message}`, 'error');
    } catch (error) {
      timing.finish('failed');
      log.error('Adding phone media failed', error);
      const message = `Adding media failed: ${error instanceof Error ? error.message : String(error)}`;
      setProblems([{ name: '', message }]);
      setPhase('result');
      showToast(message, 'error');
    }
  };

  const doneLabel = phase === 'result'
    ? 'Close'
    : busy ? 'Adding…' : picked.length > 0 ? `Add (${picked.length})` : 'Add';
  const copyLine = copyNotice && copyNotice.pendingFiles > 0
    ? `Copying ${copyNotice.pendingFiles} file${copyNotice.pendingFiles === 1 ? '' : 's'} (${formatMediaBytes(copyNotice.pendingBytes)}) into the project…`
    : null;

  return (
    <PhoneSheet
      title="Add media"
      height="tall"
      onCancel={cancel}
      onDone={() => void commit()}
      doneLabel={doneLabel}
      doneDisabled={busy || (phase === 'pick' && picked.length === 0)}
    >
      <div className="phone-media-sheet">
        <div className="phone-media-sheet__pickers">
          <button
            type="button"
            className="phone-media-sheet__pick"
            data-testid={PHONE_M1_TEST_IDS.mediaPickVisual}
            aria-disabled={busy}
            onClick={() => { if (!busy) visualInputRef.current?.click(); }}
          >
            Photos &amp; videos
          </button>
          <button
            type="button"
            className="phone-media-sheet__pick"
            data-testid={PHONE_M1_TEST_IDS.mediaPickAudio}
            aria-disabled={busy}
            onClick={() => { if (!busy) audioInputRef.current?.click(); }}
          >
            Audio &amp; files
          </button>
          <input ref={visualInputRef} type="file" accept={VISUAL_ACCEPT} multiple hidden tabIndex={-1}
            data-testid={PHONE_M1_TEST_IDS.mediaInputVisual} onChange={onFilesChosen} />
          <input ref={audioInputRef} type="file" accept={AUDIO_ACCEPT} multiple hidden tabIndex={-1}
            data-testid={PHONE_M1_TEST_IDS.mediaInputAudio} onChange={onFilesChosen} />
        </div>

        {picked.length > 0 ? (
          <>
            <p className="phone-media-sheet__hint">Added in this order</p>
            <ol className="phone-media-sheet__list">
              {picked.map((item, index) => (
                <li key={item.id} className="phone-media-sheet__item" data-testid={PHONE_M1_TEST_IDS.mediaPickedItem}>
                  <span className="phone-media-sheet__order" aria-hidden="true">{index + 1}</span>
                  <span className="phone-media-sheet__name">{item.file.name}</span>
                  <span className="phone-media-sheet__meta">{kindLabel(item.file)} · {formatMediaBytes(item.file.size)}</span>
                  <button
                    type="button"
                    className="phone-media-sheet__remove"
                    aria-label={`Remove ${item.file.name}`}
                    aria-disabled={busy}
                    onClick={() => { if (!busy) remove(item.id); }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : phase === 'pick' ? (
          <p className="phone-media-sheet__hint">Pick one or more files. They are copied into the project so it reopens later.</p>
        ) : null}

        <div className="phone-media-sheet__modes" role="radiogroup" aria-label="Placement">
          {([['append', 'Append to main track'], ['overlay', 'Overlay at playhead']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              aria-disabled={busy}
              className="phone-media-sheet__mode"
              data-mode={value}
              onClick={() => { if (!busy) setMode(value); }}
            >
              {label}
            </button>
          ))}
        </div>

        {busy || copyLine ? (
          <div className="phone-media-sheet__progress" data-testid={PHONE_M1_TEST_IDS.mediaProgress} role="status" aria-live="polite">
            {phase === 'importing' && progress ? (
              <>
                <span>Importing {progress.index + 1} of {progress.total}: {progress.name}</span>
                <progress max={progress.total} value={progress.index} />
              </>
            ) : null}
            {phase === 'placing' ? <span>Placing on the timeline…</span> : null}
            {copyLine ? <span className="phone-media-sheet__copy">{copyLine}</span> : null}
          </div>
        ) : null}

        {problems.length > 0 ? (
          <ul className="phone-media-sheet__problems" role="alert">
            {problems.map((problem, index) => <li key={`${problem.name}-${index}`}>{problem.message}</li>)}
          </ul>
        ) : null}
      </div>
    </PhoneSheet>
  );
};
