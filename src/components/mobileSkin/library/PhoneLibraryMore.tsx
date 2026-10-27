// Library > Storage and sequences: import numbered 3D model or Gaussian-splat files as one sequence
// (the editor's own batch import groups them), where proxies are stored (and a proxy folder where the
// browser can pick one), and the playback warm-up of the full editor with its progress.
import { useRef, useState, type ChangeEvent } from 'react';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { collectTimelineProxyWarmupVideos } from '../../../services/timeline/timelineProxyCacheRuntime';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from './phoneListUi';
import { PHONE_LIBRARY_MORE_TEST_IDS as IDS } from './phoneLibraryTestIds';
import { PHONE_LIBRARY_LIMITS, PHONE_SEQUENCE_ACCEPT } from './phoneLibraryLimits';

const log = Logger.create('PhoneLibraryMore');



export function PhoneLibraryMore({ folderId, onBack }: { folderId: string | null; onBack: () => void }) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const proxyFolderName = useMediaStore((state) => state.proxyFolderName);
  const warming = useTimelineStore((state) => state.isProxyCaching);
  const warmProgress = useTimelineStore((state) => state.proxyCacheProgress);
  const [busy, setBusy] = useState(false);
  const sequenceInput = useRef<HTMLInputElement>(null);
  const { status, report } = usePhoneStatus();
  const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const onSequence = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      const before = useMediaStore.getState().files.length;
      const results = await useMediaStore.getState().importFiles(files, folderId);
      const added = useMediaStore.getState().files.length - before;
      report(results.length > 0 || added > 0
        ? { ok: true, message: `${files.length} file${files.length === 1 ? '' : 's'} became ${Math.max(added, results.length)} Library item${Math.max(added, results.length) === 1 ? '' : 's'}${files.length > Math.max(added, results.length) ? ' (numbered files were joined into a sequence)' : ''}.` }
        : { ok: false, message: 'Nothing was imported. Pick numbered .glb, .ply or splat files of one sequence.' });
    } catch (error) {
      log.warn('Sequence import failed', error);
      report({ ok: false, message: `The import failed: ${error instanceof Error ? error.message : String(error)}.` });
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    if (!canPickFolder) {
      showUnavailable({ actionId: 'library-proxy-folder', label: 'Proxy folder', reason: PHONE_LIBRARY_LIMITS.proxyFolder });
      return;
    }
    const handle = await useMediaStore.getState().pickProxyFolder();
    report(handle ? { ok: true, message: `Proxies are now stored in “${handle.name}”.` } : { ok: true, message: 'No folder picked; the proxy storage stays as it was.' });
  };

  const warmUp = () => {
    const timeline = useTimelineStore.getState();
    if (timeline.isProxyCaching) { timeline.cancelProxyCachePreload(); report({ ok: true, message: 'Warm-up stopped.' }); return; }
    const videos = collectTimelineProxyWarmupVideos(timeline.clips);
    if (videos.length === 0) {
      report({ ok: false, message: 'Nothing to warm up: no clip on the timeline plays through a browser video element (clips decoded with WebCodecs load their frames on demand).' });
      return;
    }
    void timeline.startProxyCachePreload().then(() => {
      report({ ok: true, message: `Warm-up finished for ${videos.length} clip${videos.length === 1 ? '' : 's'}. It fills the browser's cache; it does not make proxies.` });
    });
  };

  return (
    <PhoneSheet title="Storage and sequences" height="tall" onCancel={onBack} cancelLabel="Back">
      <div className="phone-lib" data-testid={IDS.root} onPointerUpCapture={blurTappedControl}>
        <h3 className="phone-lib__section">3D and splat sequences</h3>
        <p className="phone-lib__note">Pick all numbered files of one sequence (model_0001.glb, model_0002.glb …). They become one item that plays frame by frame.</p>
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.sequenceImport} aria-disabled={busy}
          onClick={() => { if (!busy) sequenceInput.current?.click(); }}>
          {busy ? 'Importing…' : 'Import a numbered sequence'}
        </button>
        <input ref={sequenceInput} className="phone-lib__hidden-input" type="file" multiple accept={PHONE_SEQUENCE_ACCEPT}
          data-testid={IDS.sequenceInput} onChange={(event) => void onSequence(event)} />

        <h3 className="phone-lib__section">Proxy storage</h3>
        <p className="phone-lib__note" data-testid={IDS.proxyLocation}>
          {proxyFolderName ? `Proxies are stored in the folder “${proxyFolderName}”.` : 'Proxies are stored in this project’s storage on this device.'}
        </p>
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.proxyFolder} aria-disabled={!canPickFolder}
          onClick={() => void pickFolder()}>
          Choose a proxy folder
        </button>

        <h3 className="phone-lib__section">Warm up playback</h3>
        <p className="phone-lib__note">Reads through the timeline’s videos once so the first scrub is smooth.</p>
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.warmUp} aria-pressed={warming}
          onClick={warmUp}>
          {warming ? `Stop warm-up${warmProgress !== null ? ` (${warmProgress}%)` : ''}` : 'Warm up'}
        </button>
        <PhoneStatusLine status={status} testId={IDS.status} />
      </div>
    </PhoneSheet>
  );
}
