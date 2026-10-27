// M3 tools of the project sheet: Library and Settings entries, project info, duplicate, named
// versions (save, list, restore) and the .msproj archive (build, then share or save from a tap).
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { isUserVisibleComposition } from '../../../stores/mediaStore/compositionVisibility';
import { downloadBlob } from '../../../engine/export/FrameExporter';
import { projectFileService } from '../../../services/projectFileService';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import type { PhoneActionResult } from '../contracts';
import { duplicatePhoneProject } from './usePhoneProjectCommands';
import { runPhoneProjectOperation } from '../runtime/phoneProjectOperation';
import { buildPhoneProjectArchive, type PhoneProjectArchive } from './phoneProjectArchive';
import {
  currentPhoneRevision, listPhoneProjectVersions, restorePhoneProjectVersion, savePhoneProjectVersion, type PhoneProjectVersion,
} from './phoneProjectVersions';
import { PHONE_PROJECT_TEST_IDS as IDS } from './phoneProjectTestIds';
import '../library/PhoneLibrary.css';

type Section = 'duplicate' | 'versions' | 'archive' | null;

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function ProjectInfo() {
  const info = useMediaStore((state) => {
    const compositions = state.compositions.filter(isUserVisibleComposition);
    return `${compositions.length} composition${compositions.length === 1 ? '' : 's'} · ${state.files.length} media · ${state.folders.length} folder${state.folders.length === 1 ? '' : 's'}`;
  });
  return <p className="phone-lib__note" data-testid={IDS.info}>{info}</p>;
}

async function shareArchive(archive: PhoneProjectArchive): Promise<PhoneActionResult> {
  const file = new File([archive.blob], archive.filename, { type: 'application/zip' });
  const canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (!canShare) {
    downloadBlob(archive.blob, archive.filename);
    return { ok: true, message: 'Sharing is not available here; saved to your downloads instead.' };
  }
  try {
    await navigator.share({ files: [file], title: archive.filename });
    return { ok: true, message: 'Shared.' };
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return { ok: true, message: 'Share cancelled. The archive is still ready.' };
    return { ok: false, message: `Sharing failed: ${error instanceof Error ? error.message : String(error)}. Try Save instead.` };
  }
}

export function PhoneProjectTools({ projectOpen }: { projectOpen: boolean }) {
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const projectName = useMediaStore((state) => state.currentProjectName) || projectFileService.getProjectData()?.name || 'Project';
  const [section, setSection] = useState<Section>(null);
  const [copyName, setCopyName] = useState(`${projectName} copy`);
  const [versionName, setVersionName] = useState('');
  const [versions, setVersions] = useState<PhoneProjectVersion[] | null>(null);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [archive, setArchive] = useState<PhoneProjectArchive | null>(null);
  const [busy, setBusy] = useState(false);
  const { status, report } = usePhoneStatus();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const loadVersions = useCallback(async () => {
    try {
      const next = await listPhoneProjectVersions();
      if (alive.current) setVersions(next);
    } catch (error) {
      if (alive.current) report({ ok: false, message: `Versions could not be listed: ${error instanceof Error ? error.message : String(error)}.` });
    }
  }, [report]);

  useEffect(() => { if (section === 'versions') void loadVersions(); }, [section, loadVersions]);

  const toggle = (next: Section) => setSection((current) => (current === next ? null : next));
  const withBusy = async (action: () => Promise<PhoneActionResult>) => {
    if (busy) return null;
    setBusy(true);
    try { return report(await action()); } finally { if (alive.current) setBusy(false); }
  };

  const disabled = !projectOpen || busy;
  const revision = currentPhoneRevision();

  return (
    <div className="phone-lib" data-testid={IDS.tools} onPointerUpCapture={blurTappedControl}>
      <div className="phone-lib__bar">
        <button type="button" className="phone-lib__button" data-testid={IDS.openLibrary} aria-disabled={!projectOpen}
          onClick={() => { if (projectOpen) openSheet('library'); }}>
          Library
        </button>
        <button type="button" className="phone-lib__button" data-testid={IDS.openSettings} onClick={() => openSheet('settings')}>
          Settings
        </button>
      </div>
      {projectOpen && <ProjectInfo />}
      <PhoneStatusLine status={status} testId={IDS.status} />

      <div className="phone-lib__bar">
        <button type="button" className="phone-lib__chip" data-testid={IDS.duplicate} aria-pressed={section === 'duplicate'} aria-disabled={!projectOpen}
          onClick={() => { if (projectOpen) toggle('duplicate'); }}>
          Duplicate
        </button>
        <button type="button" className="phone-lib__chip" data-testid={IDS.versions} aria-pressed={section === 'versions'} aria-disabled={!projectOpen}
          onClick={() => { if (projectOpen) toggle('versions'); }}>
          Versions
        </button>
        <button type="button" className="phone-lib__chip" data-testid={IDS.archive} aria-pressed={section === 'archive'} aria-disabled={!projectOpen}
          onClick={() => { if (projectOpen) toggle('archive'); }}>
          Export .msproj
        </button>
      </div>

      {section === 'duplicate' && (
        <div className="phone-lib__inline">
          <input className="phone-lib__input" aria-label="Name of the copy" data-testid={IDS.duplicateName} value={copyName} maxLength={120}
            autoComplete="off" onChange={(event) => setCopyName(event.target.value)} />
          <button type="button" className="phone-lib__button phone-lib__button--primary" data-testid={IDS.duplicateCreate} aria-disabled={disabled}
            onClick={async () => {
              const result = await withBusy(() => runPhoneProjectOperation('create', copyName.trim(), () => duplicatePhoneProject(copyName)));
              if (result?.ok && result.message) showToast(result.message);
            }}>
            {busy ? 'Copying…' : 'Create copy'}
          </button>
        </div>
      )}

      {section === 'versions' && (
        <>
          <div className="phone-lib__inline">
            <input className="phone-lib__input" aria-label="Version name" placeholder="Name this version" data-testid={IDS.versionName}
              value={versionName} maxLength={120} autoComplete="off" onChange={(event) => setVersionName(event.target.value)} />
            <button type="button" className="phone-lib__button phone-lib__button--primary" data-testid={IDS.versionSave}
              aria-disabled={disabled || !versionName.trim()}
              onClick={async () => {
                if (!versionName.trim()) return;
                const result = await withBusy(() => savePhoneProjectVersion(versionName));
                if (result?.ok) { setVersionName(''); await loadVersions(); }
              }}>
              Save
            </button>
          </div>
          {versions === null ? <p className="phone-lib__note">Loading versions…</p> : versions.length === 0 ? (
            <p className="phone-lib__note">No saved versions yet.</p>
          ) : (
            <ul className="phone-lib__list">
              {versions.map((version) => (
                <li key={version.key} className="phone-lib__row" data-testid={IDS.versionRow} data-revision-id={version.revisionId}>
                  <button type="button" className="phone-lib__open" aria-disabled={disabled}
                    onClick={() => void withBusy(() => restorePhoneProjectVersion(version))}>
                    <span className="phone-lib__text">
                      <span className="phone-lib__name">{version.name}</span>
                      <span className="phone-lib__meta">
                        {version.createdAt ? dateFormat.format(new Date(version.createdAt)) : ''}{version.revisionId === revision ? ' · showing now' : ' · tap to restore'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {section === 'archive' && (
        <>
          <button type="button" role="switch" className="phone-lib__chip" data-testid={IDS.archiveMedia} aria-checked={includeMedia}
            aria-pressed={includeMedia} onClick={() => { setIncludeMedia(!includeMedia); setArchive(null); }}>
            Include media: {includeMedia ? 'yes' : 'no (smaller, media must be relinked)'}
          </button>
          {!archive ? (
            <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.archivePrepare} aria-disabled={disabled}
              onClick={async () => {
                if (disabled) return;
                setBusy(true);
                report({ ok: true, message: 'Packing the project…' });
                const result = await buildPhoneProjectArchive(projectName, includeMedia);
                if (!alive.current) return;
                setBusy(false);
                if (result.ok) {
                  setArchive(result.archive);
                  report({ ok: true, message: `${result.archive.filename} is ready (${Math.max(1, Math.round(result.archive.blob.size / 1024))} KB).` });
                } else report(result);
              }}>
              {busy ? 'Packing…' : 'Prepare archive'}
            </button>
          ) : (
            <div className="phone-lib__bar">
              <button type="button" className="phone-lib__button phone-lib__button--primary" data-testid={IDS.archiveShare}
                onClick={() => { void shareArchive(archive).then(report); }}>
                Share
              </button>
              <button type="button" className="phone-lib__button" data-testid={IDS.archiveSave}
                onClick={() => { downloadBlob(archive.blob, archive.filename); report({ ok: true, message: 'Saved to your downloads.' }); }}>
                Save
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
