// 'source' sheet: the phone source monitor. Pick a library file (or open it from its Library item),
// play and scrub it, mark In and Out as frames, choose one of the editor's seven placement modes and
// tap Place: the editor's placement command runs as ONE undo step (sheets/phoneEditSession.ts).
// Cancel places nothing. Closing leaves the source monitor so later placements use the library again.
import { useEffect, useState } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { ProEmptyState } from '../compositions/phoneProControls';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import { closePhoneSource, isPhoneSourceFile, placePhoneSource } from './phoneSourceCommands';
import type { PhoneSourceMode } from './phoneSourceModel';
import { PhoneSourceModes } from './PhoneSourceModes';
import { usePhoneSourcePlan } from './usePhoneSourcePlan';
import { PhoneSourceViewer } from './PhoneSourceViewer';
import { PHONE_SOURCE_TEST_IDS as IDS } from './phoneSourceTestIds';
import '../library/PhoneLibrary.css';
import './PhoneSource.css';

function SourcePicker() {
  const files = useMediaStore((state) => state.files);
  const playable = files.filter(isPhoneSourceFile);
  return (
    <>
      {playable.length === 0 ? (
        <ProEmptyState icon="source" testId={IDS.empty} title="Nothing to view yet" body="Add a video, photo or sound, then view it here and place part of it."
          action={{ label: 'Pick a file', testId: IDS.addMedia, onPress: () => usePhoneUiStore.getState().openSheet('media') }} />
      ) : <p className="phone-lib__note">Pick a file to view it and place part of it.</p>}
      {playable.map((file) => (
        <button key={file.id} type="button" className="phone-lib__button phone-lib__button--wide phone-lib__target" data-testid={IDS.pick}
          data-item-id={file.id} onClick={() => useMediaStore.getState().setSourceMonitorFile(file.id)}>
          {file.name}
        </button>
      ))}
    </>
  );
}

export const PhoneSourceSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const file = useMediaStore((state) => state.files.find((candidate) => candidate.id === state.sourceMonitorFileId && isPhoneSourceFile(candidate)));
  const session = usePhoneEditSession('Place source');
  const [mode, setMode] = useState<PhoneSourceMode>('insert');
  const [busy, setBusy] = useState(false);
  const { status, report } = usePhoneStatus();
  const trackType = file?.type === 'audio' ? 'audio' : 'video';
  const plan = usePhoneSourcePlan(mode, trackType);
  // However the sheet goes away, the source monitor ends with it.
  useEffect(() => () => closePhoneSource(), []);

  const close = () => {
    session.cancel();
    closePhoneSource();
    closeSheet();
  };

  const place = async () => {
    if (!file || busy) return;
    if (!plan.ok) { report({ ok: false, message: plan.text }); return; }
    setBusy(true);
    const result = await session.commit(async () => {
      const placed = await placePhoneSource(mode);
      // A refused placement throws, so the session rolls back anything the command already touched.
      if (!placed.ok) throw new Error(placed.message);
    });
    setBusy(false);
    if (!result.ok) { report(result); showToast(result.message, 'error'); return; }
    showToast(`${file.name} placed.`);
    closePhoneSource();
    closeSheet();
  };

  return (
    <PhoneSheet title={file ? file.name : 'Source'} height="tall" onCancel={close}
      onDone={file ? () => void place() : undefined} doneLabel={busy ? 'Placing…' : 'Place'} doneDisabled={!file || busy || !plan.ok}>
      <div className="phone-lib phone-source" data-testid={IDS.root} data-source-id={file?.id ?? ''} onPointerUpCapture={blurTappedControl}>
        <PhoneStatusLine status={status} testId={IDS.status} />
        {file ? (
          <>
            <PhoneSourceViewer key={file.id} file={file} />
            <PhoneSourceModes mode={mode} trackType={trackType} onMode={setMode} plan={plan} report={report} />
            <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.change}
              onClick={() => useMediaStore.getState().setSourceMonitorFile(null)}>
              Another source
            </button>
          </>
        ) : <SourcePicker />}
      </div>
    </PhoneSheet>
  );
};
