// Browse view of the Library sheet: folder path, import, new folder, multi-select (move, duplicate,
// delete), relink of missing media, the proxy switch and one row per item with its thumbnail.
import { ProGlyph, type ProGlyphName } from '../compositions/phoneProGlyphs';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { getLabelHex } from '../../panels/media/labelColors';
import { importPhoneFilesInOrder } from '../media/usePhoneMediaImport';
import type { PhoneActionResult } from '../contracts';
import { createPhoneLibraryFolder, duplicatePhoneLibraryItems, relinkPhoneMedia } from './phoneLibraryCommands';
import { formatPhoneDuration, listPhoneLibraryFolder, phoneLibraryPath, collectPhoneLibraryEntries, type PhoneLibraryEntry } from './phoneLibraryModel';
import { PHONE_LIBRARY_TEST_IDS as IDS } from './phoneLibraryTestIds';
import { usePhoneLibrarySource } from './phoneListUi';

export interface PhoneLibraryBrowseProps {
  folderId: string | null;
  onFolder: (folderId: string | null) => void;
  onOpenItem: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onMove: (ids: string[]) => void;
  report: (result: PhoneActionResult) => PhoneActionResult;
}

/** Line glyph of an item without a thumbnail (never a text badge). */
const KIND_GLYPH: Record<PhoneLibraryEntry['kind'], ProGlyphName> = {
  folder: 'folder', video: 'film', image: 'image', audio: 'track-audio', composition: 'variants', text: 'text', solid: 'solid',
  signal: 'data', model: 'cube', other: 'empty',
};

function entryMeta(entry: PhoneLibraryEntry): string {
  if (entry.kind === 'folder') return `Folder · ${entry.childCount ?? 0} item${entry.childCount === 1 ? '' : 's'}`;
  const duration = formatPhoneDuration(entry.duration);
  return [entry.typeLabel, duration].filter(Boolean).join(' · ');
}

export function PhoneLibraryBrowse({ folderId, onFolder, onOpenItem, onDelete, onMove, report }: PhoneLibraryBrowseProps) {
  const source = usePhoneLibrarySource();
  const proxyEnabled = useMediaStore((state) => state.proxyEnabled);
  const entries = useMemo(() => listPhoneLibraryFolder(source, folderId), [source, folderId]);
  const path = useMemo(() => phoneLibraryPath(source.folders, folderId), [source.folders, folderId]);
  const missingCount = useMemo(() => collectPhoneLibraryEntries(source).filter((entry) => entry.missing).length, [source]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const visibleSelection = selected.filter((id) => entries.some((entry) => entry.id === id));

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    report({ ok: true, message: `Importing ${files.length} file${files.length === 1 ? '' : 's'}…` });
    const outcome = await importPhoneFilesInOrder(files, undefined,
      (file) => useMediaStore.getState().importFile(file, folderId, { forceCopyToProject: true }));
    setBusy(false);
    const problems = [...outcome.failures, ...outcome.notDurable].map((problem) => problem.message);
    report(problems.length > 0
      ? { ok: false, message: [`Imported ${outcome.imported.length} of ${files.length}.`, ...problems].join(' ') }
      : { ok: true, message: `Imported ${outcome.imported.length} file${outcome.imported.length === 1 ? '' : 's'}.` });
  };

  const onRelink = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    report(await relinkPhoneMedia(files));
    setBusy(false);
  };

  const createFolder = async () => {
    if (folderDraft === null) return;
    const result = report(await createPhoneLibraryFolder(folderDraft, folderId));
    if (result.ok) setFolderDraft(null);
  };

  return (
    <div className="phone-lib" data-testid={IDS.root} data-folder-id={folderId ?? ''}>
      <nav className="phone-lib__crumbs" aria-label="Folder path" data-testid={IDS.breadcrumb}>
        <button type="button" className="phone-lib__crumb" aria-current={folderId === null ? 'page' : undefined} onClick={() => onFolder(null)}>
          Library
        </button>
        {path.map((folder) => (
          <span key={folder.id}>
            ›<button type="button" className="phone-lib__crumb" aria-current={folder.id === folderId ? 'page' : undefined} onClick={() => onFolder(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="phone-lib__bar">
        <button type="button" className="phone-lib__button" data-testid={IDS.importButton} aria-disabled={busy}
          onClick={() => { if (!busy) importInput.current?.click(); }}>
          Import
        </button>
        <input ref={importInput} className="phone-lib__hidden-input" type="file" multiple accept="video/*,audio/*,image/*"
          data-testid={IDS.importInput} onChange={(event) => void onImport(event)} />
        <button type="button" className="phone-lib__button" data-testid={IDS.newFolder}
          onClick={() => setFolderDraft((draft) => (draft === null ? 'New folder' : null))}>
          New folder
        </button>
        <button type="button" className="phone-lib__button" data-testid={IDS.selectMode} aria-pressed={selecting}
          onClick={() => { setSelecting(!selecting); setSelected([]); }}>
          {selecting ? 'Done selecting' : 'Select'}
        </button>
        <button type="button" className="phone-lib__chip" data-testid={IDS.proxyToggle} aria-pressed={proxyEnabled}
          onClick={() => useMediaStore.getState().setProxyEnabled(!proxyEnabled)}>
          Use proxies: {proxyEnabled ? 'on' : 'off'}
        </button>
      </div>

      {folderDraft !== null && (
        <form className="phone-lib__inline" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
          <input className="phone-lib__input" aria-label="Folder name" data-testid={IDS.folderNameInput} value={folderDraft}
            maxLength={120} autoComplete="off" enterKeyHint="done" onChange={(event) => setFolderDraft(event.target.value)} />
          <button type="submit" className="phone-lib__button phone-lib__button--primary" data-testid={IDS.folderCreate}>Create</button>
        </form>
      )}

      {missingCount > 0 && (
        <>
          <button type="button" className="phone-lib__button phone-lib__button--wide phone-lib__button--danger" data-testid={IDS.relinkMissing}
            aria-disabled={busy} onClick={() => { if (!busy) relinkInput.current?.click(); }}>
            {missingCount} missing – pick the files to relink
          </button>
          <input ref={relinkInput} className="phone-lib__hidden-input" type="file" multiple data-testid={IDS.relinkInput}
            onChange={(event) => void onRelink(event)} />
        </>
      )}

      {selecting && (
        <div className="phone-lib__bar" aria-label="Selected items">
          <button type="button" className="phone-lib__button" data-testid={IDS.moveSelected} aria-disabled={visibleSelection.length === 0}
            onClick={() => { if (visibleSelection.length) onMove(visibleSelection); }}>
            Move ({visibleSelection.length})
          </button>
          <button type="button" className="phone-lib__button" data-testid={IDS.duplicateSelected} aria-disabled={visibleSelection.length === 0}
            onClick={async () => {
              if (!visibleSelection.length) return;
              const result = report(await duplicatePhoneLibraryItems(visibleSelection));
              if (result.ok) setSelected([]);
            }}>
            Duplicate
          </button>
          <button type="button" className="phone-lib__button phone-lib__button--danger" data-testid={IDS.deleteSelected}
            aria-disabled={visibleSelection.length === 0} onClick={() => { if (visibleSelection.length) onDelete(visibleSelection); }}>
            Delete
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="phone-lib__note" data-testid={IDS.empty}>
          {folderId ? 'This folder is empty.' : 'No media yet. Tap Import to add videos, photos or sounds.'}
        </p>
      ) : (
        <ul className="phone-lib__list">
          {entries.map((entry) => (
            <li key={entry.id} className="phone-lib__row" data-testid={IDS.row} data-item-id={entry.id} data-item-kind={entry.kind}
              aria-selected={selecting ? visibleSelection.includes(entry.id) : undefined}>
              <button type="button" className="phone-lib__open" data-testid={IDS.rowOpen}
                onClick={() => {
                  if (selecting) toggle(entry.id);
                  else if (entry.kind === 'folder') onFolder(entry.id);
                  else onOpenItem(entry.id);
                }}>
                <span className="phone-lib__thumb" aria-hidden="true">
                  {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" draggable={false} /> : <ProGlyph name={KIND_GLYPH[entry.kind]} />}
                  {entry.labelColor !== 'none' && <span className="phone-lib__label-dot" style={{ background: getLabelHex(entry.labelColor) }} />}
                </span>
                <span className="phone-lib__text">
                  <span className="phone-lib__name">{entry.name}</span>
                  <span className={`phone-lib__meta${entry.missing ? ' phone-lib__meta--warn' : ''}`}>
                    {entry.missing ? 'Missing · ' : ''}{entryMeta(entry)}
                  </span>
                </span>
              </button>
              {selecting ? (
                <button type="button" className="phone-lib__check" data-testid={IDS.rowSelect} aria-pressed={visibleSelection.includes(entry.id)}
                  aria-label={`Select ${entry.name}`} onClick={() => toggle(entry.id)}>
                  {visibleSelection.includes(entry.id) ? '✓' : '○'}
                </button>
              ) : entry.kind === 'folder' ? (
                <button type="button" className="phone-lib__check" aria-label={`Details of ${entry.name}`} onClick={() => onOpenItem(entry.id)}>
                  ⋯
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
