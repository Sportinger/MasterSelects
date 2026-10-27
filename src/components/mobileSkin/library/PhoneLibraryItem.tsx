// Item view of the Library sheet. Name, label colour and folder are a draft: Done applies them as ONE
// undo step, Cancel goes back without changing anything. Actions below (add at playhead, duplicate,
// delete, renew thumbnail/waveform/proxy, source, relink) are their own commands with their own result.
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import type { LabelColor, MediaFile } from '../../../stores/mediaStore/types';
import { LABEL_COLORS } from '../../panels/media/labelColors';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  addPhoneLibraryItemAtPlayhead, applyPhoneLibraryItemDraft, canRenamePhoneLibraryItem, choosePhoneMediaSource,
  duplicatePhoneLibraryItems, linkPhoneProxyFile, regeneratePhoneThumbnail, regeneratePhoneWaveform, relinkPhoneMedia,
  togglePhoneProxyGeneration,
} from './phoneLibraryCommands';
import { checkPhoneLibraryMove, describePhoneMediaInfo, phoneLibraryFolderTargets } from './phoneLibraryModel';
import { PHONE_LIBRARY_TEST_IDS as IDS } from './phoneLibraryTestIds';
import { PHONE_OCR_REASON, PHONE_SHOW_IN_FILES_REASON } from './phoneLibraryLimits';
import { savePhoneSourceFile, sharePhoneSourceFile } from './phoneLibraryFileCommands';
import { isPhoneSourceFile, openPhoneSource } from '../source/phoneSourceCommands';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from './phoneListUi';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';


async function copyPhoneText(text: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, message: 'File name copied.' };
  } catch {
    return { ok: false, message: 'Copying is not allowed here.' };
  }
}

export interface PhoneLibraryItemProps {
  id: string;
  onBack: () => void;
  onDelete: (ids: string[]) => void;
}

function SourceChoices({ file, report }: { file: MediaFile; report: ReturnType<typeof usePhoneStatus>['report'] }) {
  const proxyInput = useRef<HTMLInputElement>(null);
  const selection = file.sourceSelection ?? { mode: 'auto' as const };
  const options = [
    { key: 'auto', label: 'Auto', pick: { mode: 'auto' as const } },
    { key: 'original', label: 'Original', pick: { mode: 'original' as const } },
    ...(file.linkedSources ?? []).map((source) => ({
      key: source.id, label: `${source.role === 'proxy' ? 'Proxy' : 'Linked'} · ${source.name}`,
      pick: { mode: 'linked' as const, sourceId: source.id },
    })),
  ];
  const active = selection.mode === 'linked' ? selection.sourceId : selection.mode;
  const onProxyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (picked) report(await linkPhoneProxyFile(file.id, picked));
  };
  return (
    <>
      <h3 className="phone-lib__section">Source</h3>
      <div className="phone-lib__bar">
        {options.map((option) => (
          <button key={option.key} type="button" className="phone-lib__chip" data-testid={IDS.sourceOption} data-source={option.key}
            aria-pressed={active === option.key} onClick={async () => report(await choosePhoneMediaSource(file.id, option.pick))}>
            {option.label}
          </button>
        ))}
        <button type="button" className="phone-lib__chip" data-testid={IDS.proxyLink} onClick={() => proxyInput.current?.click()}>Link a proxy file</button>
        <input ref={proxyInput} className="phone-lib__hidden-input" type="file" accept="video/*" data-testid={IDS.proxyInput} onChange={(event) => void onProxyFile(event)} />
      </div>
    </>
  );
}

export function PhoneLibraryItem({ id, onBack, onDelete }: PhoneLibraryItemProps) {
  const item = useMediaStore((state) => state.getItemById(id));
  const file = useMediaStore((state) => state.files.find((candidate) => candidate.id === id));
  const folders = useMediaStore((state) => state.folders);
  const isFolder = folders.some((folder) => folder.id === id);
  const session = usePhoneEditSession('Library item');
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const { status, report } = usePhoneStatus();
  const [draft, setDraft] = useState(() => ({
    name: item?.name ?? '', labelColor: ((item as { labelColor?: LabelColor } | undefined)?.labelColor ?? 'none') as LabelColor, folderId: item?.parentId ?? null,
  }));
  const relinkInput = useRef<HTMLInputElement>(null);
  const targets = useMemo(() => phoneLibraryFolderTargets(folders), [folders]);
  const renamable = canRenamePhoneLibraryItem(id);

  if (!item) {
    return (
      <PhoneSheet title="Library" height="tall" onCancel={onBack} cancelLabel="Back">
        <p className="phone-lib__note">This item no longer exists.</p>
      </PhoneSheet>
    );
  }

  const moveCheck = checkPhoneLibraryMove(folders, [id], draft.folderId);
  const nameInvalid = renamable && draft.name.trim().length === 0;

  const done = async () => {
    if (!moveCheck.ok) { report({ ok: false, message: moveCheck.reason }); return; }
    if (nameInvalid) { report({ ok: false, message: 'The name cannot be empty.' }); return; }
    const result = await session.commit(() => applyPhoneLibraryItemDraft(id, draft));
    if (!result.ok) { report(result); showToast(result.message, 'error'); return; }
    onBack();
  };

  const run = async (action: () => Promise<{ ok: boolean; message?: string }> | { ok: boolean; message?: string }) => {
    const result = await action();
    report(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.message ?? 'That did not work.' });
  };

  const onRelinkFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    if (picked.length) report(await relinkPhoneMedia(picked, id));
  };

  const isVisualFile = file && (file.type === 'video' || file.type === 'image');
  const hasSound = file && (file.type === 'audio' || (file.type === 'video' && file.hasAudio !== false));

  return (
    <PhoneSheet title={item.name || 'Item'} height="tall" onCancel={onBack} onDone={() => void done()} doneDisabled={!moveCheck.ok || nameInvalid}>
      <div className="phone-lib" data-testid={IDS.item} data-item-id={id} onPointerUpCapture={blurTappedControl}>
        {file?.thumbnailUrl && <img className="phone-lib__hero" src={file.thumbnailUrl} alt="" draggable={false} />}
        <label className="phone-lib__field">
          <span className="phone-lib__field-label">Name</span>
          <input className="phone-lib__input" data-testid={IDS.itemName} value={draft.name} maxLength={200} autoComplete="off"
            disabled={!renamable} aria-invalid={nameInvalid} enterKeyHint="done"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        {!renamable && <p className="phone-lib__note">This kind of item is renamed in the full editor.</p>}

        <span className="phone-lib__field-label">Label</span>
        <div className="phone-lib__labels" role="group" aria-label="Label colour">
          {LABEL_COLORS.map((color) => (
            <button key={color.key} type="button" className="phone-lib__label" data-testid={IDS.labelChip} data-label={color.key}
              aria-pressed={draft.labelColor === color.key} aria-label={color.name} title={color.name}
              style={{ background: color.key === 'none' ? 'transparent' : color.hex }}
              onClick={() => setDraft({ ...draft, labelColor: color.key })}>
              {color.key === 'none' ? 'None' : ''}
            </button>
          ))}
        </div>

        <label className="phone-lib__field">
          <span className="phone-lib__field-label">Folder</span>
          <select className="phone-lib__select" data-testid={IDS.itemFolder} value={draft.folderId ?? ''}
            onChange={(event) => setDraft({ ...draft, folderId: event.target.value || null })}>
            {targets.map((target) => (
              <option key={target.id ?? 'top'} value={target.id ?? ''} disabled={isFolder && !checkPhoneLibraryMove(folders, [id], target.id).ok}>
                {'  '.repeat(Math.max(0, target.depth - 1))}{target.label}
              </option>
            ))}
          </select>
        </label>
        {!moveCheck.ok && <p className="phone-lib__status" data-tone="error">{moveCheck.reason}</p>}

        <PhoneStatusLine status={status} testId={IDS.status} />

        <div className="phone-lib__bar">
          {!isFolder && (
            <button type="button" className="phone-lib__button" data-testid={IDS.addAtPlayhead}
              onClick={() => void run(() => addPhoneLibraryItemAtPlayhead(id))}>
              Add at playhead
            </button>
          )}
          {file && isPhoneSourceFile(file) && (
            <button type="button" className="phone-lib__button" data-testid={IDS.openSource} onClick={() => openPhoneSource(id)}>
              Source monitor
            </button>
          )}
          <button type="button" className="phone-lib__button" data-testid={IDS.duplicate}
            onClick={() => void run(() => duplicatePhoneLibraryItems([id]))}>
            Duplicate
          </button>
          <button type="button" className="phone-lib__button phone-lib__button--danger" data-testid={IDS.delete} onClick={() => onDelete([id])}>
            Delete
          </button>
        </div>

        {file && (
          <>
            <h3 className="phone-lib__section">Renew</h3>
            <div className="phone-lib__bar">
              <button type="button" className="phone-lib__button" data-testid={IDS.regenerateThumbnail} aria-disabled={!isVisualFile}
                onClick={() => void run(() => (isVisualFile ? regeneratePhoneThumbnail(id) : { ok: false, message: 'Only videos and images have a thumbnail.' }))}>
                Thumbnail
              </button>
              <button type="button" className="phone-lib__button" data-testid={IDS.regenerateWaveform} aria-disabled={!hasSound}
                onClick={() => void run(() => (hasSound ? regeneratePhoneWaveform(id) : { ok: false, message: 'This file has no sound.' }))}>
                Waveform
              </button>
              <button type="button" className="phone-lib__button" data-testid={IDS.regenerateProxy} aria-disabled={file.type !== 'video'}
                onClick={() => void run(() => togglePhoneProxyGeneration(id))}>
                {file.proxyStatus === 'generating' ? `Stop proxy ${Math.round(file.proxyProgress ?? 0)}%` : file.proxyStatus === 'ready' ? 'Proxy again' : 'Make proxy'}
              </button>
            </div>
            {file.type === 'video' && <SourceChoices file={file} report={report} />}
            <h3 className="phone-lib__section">Info</h3>
            <dl className="phone-lib__info" data-testid={IDS.itemInfo}>
              {describePhoneMediaInfo(file).map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            <button type="button" className={`phone-lib__button phone-lib__button--wide${mediaNeedsRelink(file) ? ' phone-lib__button--danger' : ''}`}
              data-testid={IDS.relinkItem} onClick={() => relinkInput.current?.click()}>
              {mediaNeedsRelink(file) ? 'Missing – pick the file' : 'Replace the source file'}
            </button>
            <input ref={relinkInput} className="phone-lib__hidden-input" type="file" data-testid={IDS.relinkItemInput} onChange={(event) => void onRelinkFile(event)} />
            <div className="phone-lib__bar">
              <button type="button" className="phone-lib__button" data-testid={IDS.saveFile} onClick={() => void run(() => savePhoneSourceFile(id))}>
                Save file
              </button>
              {/* No await before the share call: Web Share needs this tap's activation. */}
              <button type="button" className="phone-lib__button" data-testid={IDS.shareFile} onClick={() => void sharePhoneSourceFile(id).then(report)}>
                Share file
              </button>
            </div>
            {isVisualFile && (
              <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.ocr} aria-disabled="true"
                onClick={() => showUnavailable({ actionId: 'library-ocr', label: 'Read text in pictures (OCR)', reason: PHONE_OCR_REASON })}>
                Read text in pictures (OCR) · not available yet
              </button>
            )}
            <div className="phone-lib__bar">
              <button type="button" className="phone-lib__button" data-testid={IDS.copyName} onClick={() => void copyPhoneText(file.name).then(report)}>
                Copy file name
              </button>
              <button type="button" className="phone-lib__button" data-testid={IDS.showInFiles} aria-disabled="true"
                onClick={() => showUnavailable({ actionId: 'library-show-in-files', label: 'Show in file manager', reason: PHONE_SHOW_IN_FILES_REASON })}>
                Show in file manager
              </button>
            </div>
          </>
        )}
      </div>
    </PhoneSheet>
  );
}
