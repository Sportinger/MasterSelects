// Library commands of the phone skin. Every command calls the same media-store action the desktop
// Media panel calls, so a phone change is the desktop change; multi-step commands run as ONE undo
// step (runEditorBatch). Every failure resolves to { ok: false, message } the phone can show as is.

import type { PhoneActionResult } from '../contracts';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { LabelColor, MediaFile } from '../../../stores/mediaStore/types';
import type { MediaSourceSelection } from '../../../types/mediaMetadata';
import { runEditorBatch } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { addLinkedMediaSourceFile, selectMediaSource } from '../../../services/project/linkedMediaSources';
import {
  applyRelinkMatch, createRelinkCandidateMapFromFiles, findRelinkMatch, mediaNeedsRelink,
} from '../../../services/project/relinkMedia';
import { isEditRejection } from '../../../services/editRejection';
import { placePhoneMedia } from '../media/phoneMediaPlacement';
import { checkPhoneLibraryMove, isPhoneComposition } from './phoneLibraryModel';

const log = Logger.create('PhoneLibrary');

const READ_ONLY = 'This project is open read-only here, so the library cannot change.';

function fail(message: string): PhoneActionResult {
  return { ok: false, message };
}

function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function writable(): boolean {
  return getActiveRepositorySession()?.opening.writable !== false;
}

async function guarded(label: string, action: () => Promise<PhoneActionResult> | PhoneActionResult): Promise<PhoneActionResult> {
  if (!writable()) return fail(READ_ONLY);
  try {
    return await action();
  } catch (error) {
    if (isEditRejection(error)) return fail(`${label} was not applied: ${reason(error)}`);
    log.error(`${label} failed`, error);
    return fail(`${label} failed: ${reason(error)}.`);
  }
}

function itemKind(id: string): 'file' | 'folder' | 'composition' | 'signal' | 'text' | 'other' | null {
  const state = useMediaStore.getState();
  if (state.files.some((file) => file.id === id)) return 'file';
  if (state.folders.some((folder) => folder.id === id)) return 'folder';
  if (state.compositions.some((composition) => composition.id === id)) return 'composition';
  if ((state.signalAssets ?? []).some((item) => item.id === id)) return 'signal';
  if (state.textItems.some((item) => item.id === id)) return 'text';
  return state.getItemById(id) ? 'other' : null;
}

/** True when the item can be renamed on the phone (the same rename the desktop panel offers). */
export function canRenamePhoneLibraryItem(id: string): boolean {
  const kind = itemKind(id);
  return kind === 'file' || kind === 'folder' || kind === 'composition' || kind === 'signal' || kind === 'text';
}

function renameNow(id: string, name: string): void {
  const state = useMediaStore.getState();
  switch (itemKind(id)) {
    case 'file': state.renameFile(id, name); break;
    case 'folder': state.renameFolder(id, name); break;
    case 'composition': state.updateComposition(id, { name }); break;
    case 'signal': state.renameSignalAsset(id, name); break;
    case 'text': state.updateTextItem(id, { name }); break;
    default: throw new Error('this kind of item is renamed in the full editor');
  }
}

export interface PhoneLibraryItemDraft {
  name: string;
  labelColor: LabelColor;
  folderId: string | null;
}

/** Applies the item view's draft (name, label, folder) as one change; unchanged fields are skipped. */
export function applyPhoneLibraryItemDraft(id: string, draft: PhoneLibraryItemDraft): void {
  const state = useMediaStore.getState();
  const item = state.getItemById(id);
  if (!item) throw new Error('the item no longer exists');
  const name = draft.name.trim();
  if (name && name !== item.name) renameNow(id, name);
  if (((item as { labelColor?: LabelColor }).labelColor ?? 'none') !== draft.labelColor) state.setLabelColor([id], draft.labelColor);
  if ((item.parentId ?? null) !== draft.folderId) {
    const check = checkPhoneLibraryMove(state.folders, [id], draft.folderId);
    if (!check.ok) throw new Error(check.reason);
    state.moveToFolder([id], draft.folderId);
  }
}

export function createPhoneLibraryFolder(name: string, parentId: string | null): Promise<PhoneActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return Promise.resolve(fail('Give the folder a name.'));
  return guarded('New folder', () => {
    useMediaStore.getState().createFolder(trimmed, parentId);
    return { ok: true, message: `Folder "${trimmed}" created.` };
  });
}

export function movePhoneLibraryItems(ids: readonly string[], folderId: string | null): Promise<PhoneActionResult> {
  const check = checkPhoneLibraryMove(useMediaStore.getState().folders, ids, folderId);
  if (!check.ok) return Promise.resolve(fail(check.reason));
  return guarded('Move', () => {
    useMediaStore.getState().moveToFolder([...ids], folderId);
    return { ok: true, message: `Moved ${ids.length} item${ids.length === 1 ? '' : 's'}.` };
  });
}

export function duplicatePhoneLibraryItems(ids: readonly string[]): Promise<PhoneActionResult> {
  if (ids.length === 0) return Promise.resolve(fail('Select something to duplicate first.'));
  return guarded('Duplicate', () => {
    const created = useMediaStore.getState().duplicateMediaItems([...ids]);
    if (created.length === 0) return fail('Nothing could be duplicated.');
    return { ok: true, message: `Duplicated ${created.length} item${created.length === 1 ? '' : 's'}.` };
  });
}

/** Media-file usages of a planned delete: which compositions lose how many clips. */
export function phoneLibraryDeleteUsages(ids: readonly string[]) {
  const state = useMediaStore.getState();
  const fileIds = ids.filter((id) => state.files.some((file) => file.id === id));
  return fileIds.length > 0 ? state.getMediaFileUsages(fileIds) : [];
}

function removeOther(id: string): void {
  const state = useMediaStore.getState();
  const item = state.getItemById(id);
  if (!item) return;
  if (state.folders.some((folder) => folder.id === id)) { state.removeFolder(id); return; }
  if (isPhoneComposition(item)) { state.removeComposition(id); return; }
  switch ((item as { type?: string }).type) {
    case 'text': state.removeTextItem(id); break;
    case 'solid': state.removeSolidItem(id); break;
    case 'model': state.removeMeshItem(id); break;
    case 'camera': state.removeCameraItem(id); break;
    case 'light': state.removeLightItem(id); break;
    case 'splat-effector': state.removeSplatEffectorItem(id); break;
    case 'math-scene': state.removeMathSceneItem(id); break;
    case 'motion-shape': state.removeMotionShapeItem(id); break;
    case 'signal': state.removeSignalAsset(id); break;
    default: throw new Error(`"${item.name}" is removed in the full editor`);
  }
}

/** Deletes items (media everywhere they are used) as one undo step. Files on disk are never touched. */
export function deletePhoneLibraryItems(ids: readonly string[]): Promise<PhoneActionResult> {
  if (ids.length === 0) return Promise.resolve(fail('Select something to delete first.'));
  return guarded('Delete', async () => {
    const state = useMediaStore.getState();
    const fileIds = ids.filter((id) => state.files.some((file) => file.id === id));
    let removedClips = 0;
    const warnings: string[] = [];
    await runEditorBatch(ids.length === 1 ? 'Delete media' : `Delete ${ids.length} items`, async () => {
      if (fileIds.length > 0) {
        const result = await useMediaStore.getState().deleteMediaFilesEverywhere(fileIds);
        removedClips = result.removedClipCount;
        if (result.artifactFailures.length > 0) {
          log.warn('Some media caches could not be cleaned up', result.artifactFailures);
          warnings.push('Some cached previews could not be cleaned up.');
        }
      }
      for (const id of ids) if (!fileIds.includes(id)) removeOther(id);
    });
    const clips = removedClips > 0 ? ` and ${removedClips} clip${removedClips === 1 ? '' : 's'} using it` : '';
    return { ok: true, message: [`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}${clips}.`, ...warnings].join(' ') };
  });
}

/** Adds a media file or composition at the playhead on a free track above the main one (one undo step). */
export function addPhoneLibraryItemAtPlayhead(id: string): Promise<PhoneActionResult> {
  return guarded('Add to timeline', async () => {
    const state = useMediaStore.getState();
    const file = state.files.find((candidate) => candidate.id === id);
    if (file) {
      if (mediaNeedsRelink(file)) return fail(`"${file.name}" is missing. Relink it first.`);
      const outcome = await placePhoneMedia([{ name: file.name, result: file }], 'overlay');
      if (outcome.failures.length > 0) return fail(outcome.failures.map((failure) => failure.message).join(' '));
      return { ok: true, message: `"${file.name}" added at the playhead.` };
    }
    const composition = state.compositions.find((candidate) => candidate.id === id);
    if (composition) {
      if (composition.id === state.activeCompositionId) return fail('A composition cannot be placed inside itself.');
      await runEditorBatch('Add composition', async () => {
        const timeline = useTimelineStore.getState();
        const trackId = timeline.tracks.find((track) => track.type === 'video' && !track.locked
          && !timeline.clips.some((clip) => clip.trackId === track.id
            && clip.startTime < timeline.playheadPosition + composition.duration && clip.startTime + clip.duration > timeline.playheadPosition))?.id
          ?? timeline.addTrack('video');
        await timeline.addCompClip(trackId, composition, timeline.playheadPosition);
      });
      return { ok: true, message: `"${composition.name}" added at the playhead.` };
    }
    return fail('Only media files and compositions can be added from here. Text and shapes have their own tools.');
  });
}

// ---------------------------------------------------------------------------
// Derived data: thumbnails, waveforms, proxies, source choice, relink
// ---------------------------------------------------------------------------

function findFile(id: string): MediaFile | undefined {
  return useMediaStore.getState().files.find((file) => file.id === id);
}

export async function regeneratePhoneThumbnail(id: string): Promise<PhoneActionResult> {
  const file = findFile(id);
  if (!file) return fail('The media file no longer exists.');
  try {
    const made = await useMediaStore.getState().ensureFileThumbnail(id, { force: true });
    return made ? { ok: true, message: 'Thumbnail renewed.' } : fail(`No thumbnail could be made for "${file.name}".`);
  } catch (error) {
    log.warn('Thumbnail regeneration failed', error);
    return fail(`The thumbnail could not be renewed: ${reason(error)}.`);
  }
}

const WAVEFORM_WAIT_MS = 60_000;

function waitForWaveform(id: string): Promise<MediaFile['waveformStatus']> {
  const current = findFile(id)?.waveformStatus;
  if (current !== 'generating') return Promise.resolve(current);
  return new Promise((resolve) => {
    const stop = useMediaStore.subscribe((state) => {
      const status = state.files.find((file) => file.id === id)?.waveformStatus;
      if (status !== 'generating') { stop(); clearTimeout(timer); resolve(status); }
    });
    const timer = setTimeout(() => { stop(); resolve('generating'); }, WAVEFORM_WAIT_MS);
  });
}

export async function regeneratePhoneWaveform(id: string): Promise<PhoneActionResult> {
  const file = findFile(id);
  if (!file) return fail('The media file no longer exists.');
  try {
    await useMediaStore.getState().generateMediaWaveform(id, { force: true });
    // The action can resolve while the waveform is still being drawn; report the real outcome.
    const status = await waitForWaveform(id);
    if (status === 'generating') return { ok: true, message: 'The waveform is still being drawn; it appears when ready.' };
    if (status === 'error') return fail(`The waveform of "${file.name}" could not be made.`);
    if (status === 'skipped') return fail(`"${file.name}" has no sound to draw.`);
    return { ok: true, message: 'Waveform renewed.' };
  } catch (error) {
    log.warn('Waveform regeneration failed', error);
    return fail(`The waveform could not be renewed: ${reason(error)}.`);
  }
}

/** Starts (or stops) the editor's own proxy for a video; the progress shows in the item view. */
export function togglePhoneProxyGeneration(id: string): PhoneActionResult {
  const file = findFile(id);
  if (!file) return fail('The media file no longer exists.');
  if (file.type !== 'video') return fail('Only videos get a proxy.');
  const state = useMediaStore.getState();
  if (file.proxyStatus === 'generating') {
    state.cancelProxyGeneration(id);
    return { ok: true, message: 'Proxy stopped.' };
  }
  if (!file.file) return fail(`"${file.name}" is missing. Relink it first.`);
  void state.generateProxy(id, { force: file.proxyStatus === 'ready' }).catch((error: unknown) => {
    log.warn('Proxy generation failed', error);
  });
  return { ok: true, message: 'Making a proxy…' };
}

export async function choosePhoneMediaSource(id: string, selection: MediaSourceSelection): Promise<PhoneActionResult> {
  try {
    const selected = await selectMediaSource(id, selection);
    if (!selected) return fail(selection.mode === 'linked' ? 'That linked file is not available here. Relink it first.' : 'The source could not be switched.');
    return { ok: true, message: selection.mode === 'original' ? 'Using the original.' : selection.mode === 'auto' ? 'Source: automatic.' : 'Using the linked file.' };
  } catch (error) {
    log.warn('Source switch failed', error);
    return fail(`The source could not be switched: ${reason(error)}.`);
  }
}

export async function linkPhoneProxyFile(id: string, file: File): Promise<PhoneActionResult> {
  try {
    const linked = await addLinkedMediaSourceFile(id, file);
    return linked ? { ok: true, message: `"${file.name}" linked as a proxy.` } : fail(`"${file.name}" could not be linked.`);
  } catch (error) {
    log.warn('Linking a proxy failed', error);
    return fail(`"${file.name}" could not be linked: ${reason(error)}.`);
  }
}

/** Relinks missing media from picked files; `onlyId` limits it to one item (the picked file is tried directly). */
export async function relinkPhoneMedia(files: readonly File[], onlyId?: string): Promise<PhoneActionResult> {
  if (files.length === 0) return fail('No file was picked.');
  const candidates = createRelinkCandidateMapFromFiles(files);
  const targets = useMediaStore.getState().files.filter((file) => (onlyId ? file.id === onlyId : mediaNeedsRelink(file)));
  if (targets.length === 0) return { ok: true, message: 'Nothing is missing.' };
  let linked = 0;
  const problems: string[] = [];
  for (const target of targets) {
    const direct = onlyId && files.length === 1 ? { name: files[0].name, file: files[0] } : undefined;
    const match = findRelinkMatch(target, candidates, direct ? { directCandidate: direct } : undefined);
    if (!match) continue;
    try {
      if (await applyRelinkMatch(target.id, match)) linked += 1;
      else problems.push(`"${target.name}" could not be relinked.`);
    } catch (error) {
      problems.push(`"${target.name}": ${reason(error)}`);
    }
  }
  const missing = targets.length - linked - problems.length;
  const parts = [`Relinked ${linked} of ${targets.length}.`];
  if (missing > 0) parts.push(`${missing} had no matching file.`);
  parts.push(...problems);
  return linked > 0 ? { ok: true, message: parts.join(' ') } : fail(parts.join(' '));
}
