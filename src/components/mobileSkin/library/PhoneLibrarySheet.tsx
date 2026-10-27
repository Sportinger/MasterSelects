// 'library' sheet: every item of the project (media, compositions, folders, text, data) with folders,
// rename and labels, delete with a usage warning, duplicate, info, add at the playhead, proxies,
// relink and renewing thumbnails/waveforms. Views: browse -> item -> delete / move.
import { useMemo, useState, type ClipboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { PhoneLibraryBrowse } from './PhoneLibraryBrowse';
import { PhoneLibraryItem } from './PhoneLibraryItem';
import { deletePhoneLibraryItems, movePhoneLibraryItems, phoneLibraryDeleteUsages } from './phoneLibraryCommands';
import { checkPhoneLibraryMove, describePhoneMediaUsage, phoneLibraryFolderTargets } from './phoneLibraryModel';
import { PHONE_LIBRARY_MORE_TEST_IDS, PHONE_LIBRARY_TEST_IDS as IDS, PHONE_LIBRARY_WEB_TEST_IDS } from './phoneLibraryTestIds';
import { PhoneLibraryWeb } from './PhoneLibraryWeb';
import { PhoneLibraryMore } from './PhoneLibraryMore';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from './phoneListUi';
import { readPhoneClipboard, readPhonePasteEvent, type PhoneClipboardContent } from './phoneClipboardImport';
import { countRunningPhoneMediaJobs } from './phoneMediaJobs';
import { importPhoneFilesInOrder } from '../media/usePhoneMediaImport';
import './PhoneLibrary.css';

type View =
  | { kind: 'browse' }
  | { kind: 'item'; id: string }
  | { kind: 'delete'; ids: string[]; back: View }
  | { kind: 'move'; ids: string[] }
  | { kind: 'web'; link?: string }
  | { kind: 'more' };

function DeleteConfirm({ ids, onBack, onDeleted }: { ids: string[]; onBack: () => void; onDeleted: (message: string) => void }) {
  const usages = useMemo(() => phoneLibraryDeleteUsages(ids), [ids]);
  const lines = describePhoneMediaUsage(usages);
  const names = useMediaStore(useShallow((state) => ids.map((id) => state.getItemById(id)?.name ?? id)));
  const { status, report } = usePhoneStatus();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const result = report(await deletePhoneLibraryItems(ids));
    setBusy(false);
    if (result.ok) onDeleted(result.message ?? 'Deleted.');
  };
  return (
    <PhoneSheet title="Delete?" height="tall" onCancel={onBack}>
      <div className="phone-lib" data-testid={IDS.deleteConfirm} onPointerUpCapture={blurTappedControl}>
        <p className="phone-lib__note">
          {ids.length === 1 ? `"${names[0]}"` : `${ids.length} items`} leave the project. Files on your phone stay untouched.
        </p>
        {lines.length > 0 ? (
          <>
            <p className="phone-lib__note">These clips use it and are removed too:</p>
            <ul className="phone-lib__usage">
              {lines.map((line) => <li key={line} data-testid={IDS.deleteUsage}>{line}</li>)}
            </ul>
          </>
        ) : (
          <p className="phone-lib__note">No clip uses it.</p>
        )}
        <PhoneStatusLine status={status} testId={IDS.status} />
        <button type="button" className="phone-lib__button phone-lib__button--wide phone-lib__button--danger" data-testid={IDS.deleteConfirmButton}
          aria-disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.deleteKeepButton} onClick={onBack}>
          Keep it
        </button>
      </div>
    </PhoneSheet>
  );
}

function MovePicker({ ids, onBack, onMoved }: { ids: string[]; onBack: () => void; onMoved: (message: string) => void }) {
  const folders = useMediaStore((state) => state.folders);
  const targets = useMemo(() => phoneLibraryFolderTargets(folders), [folders]);
  const { status, report } = usePhoneStatus();
  return (
    <PhoneSheet title={`Move ${ids.length} item${ids.length === 1 ? '' : 's'} to`} height="tall" onCancel={onBack}>
      <div className="phone-lib" onPointerUpCapture={blurTappedControl}>
        <PhoneStatusLine status={status} testId={IDS.status} />
        {targets.map((target) => {
          const check = checkPhoneLibraryMove(folders, ids, target.id);
          return (
            <button key={target.id ?? 'top'} type="button" className="phone-lib__button phone-lib__button--wide phone-lib__target"
              style={{ paddingLeft: 14 + Math.max(0, target.depth - 1) * 16 }} data-testid={IDS.moveTarget} data-folder-id={target.id ?? ''}
              aria-disabled={!check.ok}
              onClick={async () => {
                if (!check.ok) { report({ ok: false, message: check.reason }); return; }
                const result = report(await movePhoneLibraryItems(ids, target.id));
                if (result.ok) onMoved(result.message ?? 'Moved.');
              }}>
              {target.label}
            </button>
          );
        })}
      </div>
    </PhoneSheet>
  );
}

export const PhoneLibrarySheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const [view, setView] = useState<View>({ kind: 'browse' });
  const [folderId, setFolderId] = useState<string | null>(null);
  const { status, report } = usePhoneStatus();
  const runningJobs = useMediaStore((state) => countRunningPhoneMediaJobs(state.files));
  const [pasting, setPasting] = useState(false);
  const browse = () => setView({ kind: 'browse' });

  /** Imports pasted files into the open folder, opens a pasted link in Web sources, names other text. */
  const takePasted = async (content: PhoneClipboardContent) => {
    if (content.kind === 'denied') { report({ ok: false, message: content.message }); return; }
    if (content.kind === 'empty') { report({ ok: false, message: 'The clipboard holds no image, file or link.' }); return; }
    if (content.kind === 'text') {
      report({ ok: false, message: `The clipboard holds text, not media or a link: "${content.text.slice(0, 40)}". Titles are added with Text.` });
      return;
    }
    if (content.kind === 'link') { setView({ kind: 'web', link: content.url }); return; }
    setPasting(true);
    report({ ok: true, message: `Pasting ${content.files.length} file${content.files.length === 1 ? '' : 's'}…` });
    const outcome = await importPhoneFilesInOrder(content.files, undefined,
      (file) => useMediaStore.getState().importFile(file, folderId, { forceCopyToProject: true }));
    setPasting(false);
    const problems = [...outcome.failures, ...outcome.notDurable].map((problem) => problem.message);
    report(problems.length > 0
      ? { ok: false, message: [`Pasted ${outcome.imported.length} of ${content.files.length}.`, ...problems].join(' ') }
      : { ok: true, message: `Pasted ${outcome.imported.length} file${outcome.imported.length === 1 ? '' : 's'} into the library.` });
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // Typing into a field keeps the browser's own paste.
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    void takePasted(readPhonePasteEvent(event.clipboardData));
  };

  if (view.kind === 'item') {
    return <PhoneLibraryItem key={view.id} id={view.id} onBack={browse} onDelete={(ids) => setView({ kind: 'delete', ids, back: view })} />;
  }
  if (view.kind === 'delete') {
    return (
      <DeleteConfirm ids={view.ids} onBack={() => setView(view.back)}
        onDeleted={(message) => { report({ ok: true, message }); browse(); }} />
    );
  }
  if (view.kind === 'web') return <PhoneLibraryWeb onBack={browse} initialLink={view.link} />;
  if (view.kind === 'more') return <PhoneLibraryMore folderId={folderId} onBack={browse} />;
  if (view.kind === 'move') {
    return <MovePicker ids={view.ids} onBack={browse} onMoved={(message) => { report({ ok: true, message }); browse(); }} />;
  }
  return (
    <PhoneSheet title="Library" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div onPointerUpCapture={blurTappedControl} onPaste={onPaste}>
        <PhoneStatusLine status={status} testId={IDS.status} />
        <div className="phone-lib phone-lib__entries">
          <div className="phone-lib__bar">
            <button type="button" className="phone-lib__button" data-testid={PHONE_LIBRARY_WEB_TEST_IDS.entry} onClick={() => setView({ kind: 'web' })}>
              Web sources
            </button>
            <button type="button" className="phone-lib__button" data-testid={PHONE_LIBRARY_MORE_TEST_IDS.entry} onClick={() => setView({ kind: 'more' })}>
              Storage and sequences
            </button>
            <button type="button" className="phone-lib__button" data-testid={IDS.paste} aria-disabled={pasting}
              onClick={async () => { if (!pasting) await takePasted(await readPhoneClipboard()); }}>
              {pasting ? 'Pasting…' : 'Paste'}
            </button>
            <button type="button" className="phone-lib__button" data-testid={IDS.jobsEntry} data-running={runningJobs}
              onClick={() => usePhoneUiStore.getState().openSheet('mediaJobs')}>
              {runningJobs > 0 ? `Jobs · ${runningJobs} running` : 'Jobs'}
            </button>
          </div>
        </div>
        <PhoneLibraryBrowse
          folderId={folderId}
          onFolder={setFolderId}
          onOpenItem={(id) => setView({ kind: 'item', id })}
          onDelete={(ids) => setView({ kind: 'delete', ids, back: { kind: 'browse' } })}
          onMove={(ids) => setView({ kind: 'move', ids })}
          report={report}
        />
      </div>
    </PhoneSheet>
  );
};
