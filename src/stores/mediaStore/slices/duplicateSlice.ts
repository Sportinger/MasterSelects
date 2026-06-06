// Copy / paste / duplicate for media-panel items (#187)
//
// Duplication is a *reference* clone: media files keep pointing at the same
// underlying File/projectPath/fileHash, but get a fresh id and their own blob
// URL so removing one entry never revokes another's URL. Plain-data items
// (text, solids, meshes, ...) and compositions are cloned with a new id.

import type { MediaFile, MediaSliceCreator, MediaState } from '../types';
import { generateId } from '../helpers/importPipeline';
import {
  createMediaObjectUrl,
  createPrimaryMediaObjectUrl,
  getGaussianSplatSequenceFrameObjectUrlKey,
  getModelSequenceFrameObjectUrlKey,
} from '../../../services/project/mediaObjectUrlManager';

export interface DuplicateActions {
  copyMediaItems: (ids: string[]) => void;
  hasMediaClipboard: () => boolean;
  pasteMediaItems: (targetParentId?: string | null) => string[];
  duplicateMediaItems: (ids: string[]) => string[];
}

// In-memory clipboard. Not persisted/reactive on purpose — paste is a no-op
// when empty and we resolve the ids lazily so deleted items are skipped.
let mediaClipboardIds: string[] = [];

type Store = MediaState & DuplicateActions & {
  createFolder: (name: string, parentId?: string | null) => { id: string };
  duplicateComposition: (id: string) => { id: string; parentId: string | null } | null;
  moveToFolder: (itemIds: string[], folderId: string | null) => void;
  getItemsByFolder: (folderId: string | null) => Array<{ id: string }>;
  getItemById: (id: string) => { id: string } | undefined;
  setSelection: (ids: string[]) => void;
  ensureFileThumbnail?: (id: string, options?: { force?: boolean }) => Promise<boolean>;
};

const copyName = (name: string): string => `${name} Copy`;

/**
 * Duplicate a single media-panel item by id. `parentOverride` (when provided)
 * places the clone in that folder; otherwise it stays next to the original.
 * Returns the new item's id, or null if the id was not found.
 */
function duplicateItemById(
  get: () => Store,
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  id: string,
  parentOverride?: string | null,
): string | null {
  const state = get();
  const resolveParent = (originalParentId: string | null): string | null => (
    parentOverride !== undefined ? parentOverride : originalParentId
  );

  // Media file — reference clone with a fresh, independent blob URL.
  const file = state.files.find((f) => f.id === id);
  if (file) {
    const newId = generateId();
    const modelSequence = file.modelSequence
      ? {
          ...file.modelSequence,
          frames: file.modelSequence.frames.map((frame, index) => ({
            ...frame,
            modelUrl: frame.file
              ? createMediaObjectUrl(newId, getModelSequenceFrameObjectUrlKey(index), frame.file)
              : frame.modelUrl,
          })),
        }
      : undefined;
    const gaussianSplatSequence = file.gaussianSplatSequence
      ? {
          ...file.gaussianSplatSequence,
          frames: file.gaussianSplatSequence.frames.map((frame, index) => ({
            ...frame,
            splatUrl: frame.file
              ? createMediaObjectUrl(newId, getGaussianSplatSequenceFrameObjectUrlKey(index), frame.file)
              : frame.splatUrl,
          })),
        }
      : undefined;
    const url =
      modelSequence?.frames[0]?.modelUrl ??
      gaussianSplatSequence?.frames[0]?.splatUrl ??
      (file.file ? createPrimaryMediaObjectUrl(newId, file.file) : file.url);
    const cloned: MediaFile = {
      ...file,
      id: newId,
      parentId: resolveParent(file.parentId),
      name: copyName(file.name),
      // Mint a private URL when we still hold the File; otherwise best-effort reuse.
      url,
      modelSequence,
      gaussianSplatSequence,
      // Drop derived blob-url artifacts so they regenerate per-clone (no shared revoke).
      thumbnailUrl: undefined,
      proxyVideoUrl: undefined,
      audioProxyUrl: undefined,
      createdAt: Date.now(),
    };
    set((s) => ({ files: [...s.files, cloned] }));
    void get().ensureFileThumbnail?.(newId);
    return newId;
  }

  // Folder — recreate then recursively duplicate its contents.
  const folder = state.folders.find((f) => f.id === id);
  if (folder) {
    const newFolder = get().createFolder(copyName(folder.name), resolveParent(folder.parentId));
    for (const child of get().getItemsByFolder(folder.id)) {
      duplicateItemById(get, set, child.id, newFolder.id);
    }
    return newFolder.id;
  }

  // Composition — reuse the dedicated clone, then relocate if pasting into a folder.
  const composition = state.compositions.find((c) => c.id === id);
  if (composition) {
    const dup = get().duplicateComposition(id);
    if (!dup) return null;
    if (parentOverride !== undefined && parentOverride !== dup.parentId) {
      get().moveToFolder([dup.id], parentOverride);
    }
    return dup.id;
  }

  // Plain-data items (text/solid/mesh/camera/effector/math-scene/motion-shape).
  // Each lives in its own array but shares the { id, name, parentId, createdAt } shape.
  const plainArrays: Array<keyof MediaState> = [
    'textItems', 'solidItems', 'meshItems', 'cameraItems',
    'splatEffectorItems', 'mathSceneItems', 'motionShapeItems',
  ];
  for (const key of plainArrays) {
    const arr = state[key] as Array<{ id: string; name: string; parentId: string | null }> | undefined;
    const item = arr?.find((entry) => entry.id === id);
    if (item) {
      const newId = generateId();
      const cloned = {
        ...item,
        id: newId,
        parentId: resolveParent(item.parentId),
        name: copyName(item.name),
        createdAt: Date.now(),
      };
      set((s) => ({ [key]: [...(s[key] as unknown[]), cloned] } as unknown as Partial<MediaState>));
      return newId;
    }
  }

  // Signal asset — clone the wrapper and its nested asset with fresh ids.
  const signalAsset = state.signalAssets?.find((entry) => entry.id === id);
  if (signalAsset) {
    const newId = generateId();
    const cloned = {
      ...signalAsset,
      id: newId,
      parentId: resolveParent(signalAsset.parentId),
      name: copyName(signalAsset.name),
      createdAt: Date.now(),
      asset: signalAsset.asset
        ? { ...signalAsset.asset, id: generateId(), name: copyName(signalAsset.asset.name ?? signalAsset.name) }
        : signalAsset.asset,
    };
    set((s) => ({ signalAssets: [...(s.signalAssets ?? []), cloned] }));
    return newId;
  }

  return null;
}

export const createDuplicateSlice: MediaSliceCreator<DuplicateActions> = (set, get) => ({
  copyMediaItems: (ids: string[]) => {
    const store = get() as Store;
    // Keep only ids that still resolve to a real item.
    mediaClipboardIds = ids.filter((id) => Boolean(store.getItemById(id)));
  },

  hasMediaClipboard: () => mediaClipboardIds.length > 0,

  pasteMediaItems: (targetParentId: string | null = null) => {
    const store = get() as Store;
    const newIds: string[] = [];
    for (const id of mediaClipboardIds) {
      const newId = duplicateItemById(() => get() as Store, set, id, targetParentId);
      if (newId) newIds.push(newId);
    }
    if (newIds.length > 0) {
      store.setSelection(newIds);
    }
    return newIds;
  },

  duplicateMediaItems: (ids: string[]) => {
    const store = get() as Store;
    const newIds: string[] = [];
    for (const id of ids) {
      // parentOverride omitted -> clone stays in the same folder as the original.
      const newId = duplicateItemById(() => get() as Store, set, id);
      if (newId) newIds.push(newId);
    }
    if (newIds.length > 0) {
      store.setSelection(newIds);
    }
    return newIds;
  },
});
