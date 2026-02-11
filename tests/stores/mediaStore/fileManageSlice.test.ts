/**
 * Tests for MediaStore file management operations.
 *
 * Since the real mediaStore is mocked in setup.ts (due to heavy import chains),
 * we create a minimal Zustand store that includes only the slices under test.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { create } from 'zustand';
import type { MediaState, MediaFile, MediaFolder, TextItem, SolidItem, Composition, LabelColor } from '../../../src/stores/mediaStore/types';
import { createFileManageSlice, type FileManageActions } from '../../../src/stores/mediaStore/slices/fileManageSlice';
import { createFolderSlice, type FolderActions } from '../../../src/stores/mediaStore/slices/folderSlice';
import { createSelectionSlice, type SelectionActions } from '../../../src/stores/mediaStore/slices/selectionSlice';
import { createCompositionSlice, type CompositionActions } from '../../../src/stores/mediaStore/slices/compositionSlice';

// ---- Minimal store factory ------------------------------------------------

type TestState = MediaState & FileManageActions & FolderActions & SelectionActions & CompositionActions & {
  getActiveComposition: () => Composition | undefined;
  createTextItem: (name?: string, parentId?: string | null) => string;
  removeTextItem: (id: string) => void;
  createSolidItem: (name?: string, color?: string, parentId?: string | null) => string;
  removeSolidItem: (id: string) => void;
  updateSolidItem: (id: string, updates: Partial<{ color: string; width: number; height: number }>) => void;
  getItemsByFolder: (folderId: string | null) => (MediaFile | Composition | MediaFolder | TextItem | SolidItem)[];
  getItemById: (id: string) => MediaFile | Composition | MediaFolder | TextItem | SolidItem | undefined;
  getFileByName: (name: string) => MediaFile | undefined;
  getOrCreateTextFolder: () => string;
  getOrCreateSolidFolder: () => string;
};

function createTestStore() {
  return create<TestState>()((set, get) => ({
    // Minimal initial state
    files: [],
    compositions: [{
      id: 'comp-1',
      name: 'Comp 1',
      type: 'composition' as const,
      parentId: null,
      createdAt: Date.now(),
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 60,
      backgroundColor: '#000000',
    }],
    folders: [],
    textItems: [],
    solidItems: [],
    activeCompositionId: 'comp-1',
    openCompositionIds: ['comp-1'],
    slotAssignments: {},
    previewCompositionId: null,
    activeLayerSlots: {},
    layerOpacities: {},
    selectedIds: [],
    expandedFolderIds: [],
    currentProjectId: null,
    currentProjectName: 'Untitled Project',
    isLoading: false,
    proxyEnabled: false,
    proxyGenerationQueue: [],
    currentlyGeneratingProxyId: null,
    fileSystemSupported: false,
    proxyFolderName: null,

    // Getters inlined from the real store
    getActiveComposition: () => {
      const { compositions, activeCompositionId } = get();
      return compositions.find((c) => c.id === activeCompositionId);
    },

    getItemsByFolder: (folderId: string | null) => {
      const { files, compositions, folders, textItems, solidItems } = get();
      return [
        ...folders.filter((f) => f.parentId === folderId),
        ...compositions.filter((c) => c.parentId === folderId),
        ...textItems.filter((t) => t.parentId === folderId),
        ...solidItems.filter((s) => s.parentId === folderId),
        ...files.filter((f) => f.parentId === folderId),
      ];
    },

    getItemById: (id: string) => {
      const { files, compositions, folders, textItems, solidItems } = get();
      return (
        files.find((f) => f.id === id) ||
        compositions.find((c) => c.id === id) ||
        folders.find((f) => f.id === id) ||
        textItems.find((t) => t.id === id) ||
        solidItems.find((s) => s.id === id)
      );
    },

    getFileByName: (name: string) => {
      return get().files.find((f) => f.name === name);
    },

    // Text items
    createTextItem: (name?: string, parentId?: string | null) => {
      const { textItems } = get();
      const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newText: TextItem = {
        id,
        name: name || `Text ${textItems.length + 1}`,
        type: 'text' as const,
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        text: 'New Text',
        fontFamily: 'Arial',
        fontSize: 48,
        color: '#ffffff',
        duration: 5,
      };
      set({ textItems: [...textItems, newText] });
      return id;
    },

    removeTextItem: (id: string) => {
      set({ textItems: get().textItems.filter(t => t.id !== id) });
    },

    // Solid items
    createSolidItem: (name?: string, color?: string, parentId?: string | null) => {
      const { solidItems } = get();
      const id = `solid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const activeComp = get().getActiveComposition();
      const compWidth = activeComp?.width || 1920;
      const compHeight = activeComp?.height || 1080;
      const newSolid: SolidItem = {
        id,
        name: name || `Solid ${solidItems.length + 1}`,
        type: 'solid' as const,
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        color: color || '#ffffff',
        width: compWidth,
        height: compHeight,
        duration: 5,
      };
      set({ solidItems: [...solidItems, newSolid] });
      return id;
    },

    removeSolidItem: (id: string) => {
      set({ solidItems: get().solidItems.filter(s => s.id !== id) });
    },

    updateSolidItem: (id: string, updates: Partial<{ color: string; width: number; height: number }>) => {
      set({
        solidItems: get().solidItems.map(s =>
          s.id === id
            ? {
                ...s,
                ...(updates.color !== undefined && { color: updates.color, name: `Solid ${updates.color}` }),
                ...(updates.width !== undefined && { width: updates.width }),
                ...(updates.height !== undefined && { height: updates.height }),
              }
            : s
        ),
      });
    },

    // Get or create "Text" folder
    getOrCreateTextFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Text' && f.parentId === null);
      if (existingFolder) return existingFolder.id;
      const newFolder = createFolder('Text', null);
      return newFolder.id;
    },

    // Get or create "Solids" folder
    getOrCreateSolidFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Solids' && f.parentId === null);
      if (existingFolder) return existingFolder.id;
      const newFolder = createFolder('Solids', null);
      return newFolder.id;
    },

    // Spread slice actions
    ...createFileManageSlice(set, get),
    ...createFolderSlice(set, get),
    ...createSelectionSlice(set, get),
    ...createCompositionSlice(set, get),
  }));
}

// ---- Helpers ---------------------------------------------------------------

function makeMediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  const id = overrides.id || `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    name: `test-video-${id}.mp4`,
    type: 'video',
    parentId: null,
    createdAt: Date.now(),
    file: new File([], 'test.mp4', { type: 'video/mp4' }),
    url: `blob:http://localhost/${id}`,
    duration: 10,
    width: 1920,
    height: 1080,
    fileSize: 1024 * 1024,
    ...overrides,
  };
}

// ---- Tests -----------------------------------------------------------------

describe('MediaStore - File Management', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  // --- Adding media files ---

  describe('adding media files', () => {
    it('should add a media file to the store via setState', () => {
      const file = makeMediaFile({ id: 'f1', name: 'clip.mp4' });
      store.setState({ files: [file] });

      expect(store.getState().files).toHaveLength(1);
      expect(store.getState().files[0].name).toBe('clip.mp4');
    });

    it('should preserve existing files when adding more', () => {
      const file1 = makeMediaFile({ id: 'f1' });
      const file2 = makeMediaFile({ id: 'f2' });

      store.setState({ files: [file1] });
      store.setState((s) => ({ files: [...s.files, file2] }));

      expect(store.getState().files).toHaveLength(2);
    });
  });

  // --- Removing media files ---

  describe('removeFile', () => {
    it('should remove a file by id', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });

      store.getState().removeFile('f1');

      expect(store.getState().files).toHaveLength(0);
    });

    it('should also remove the id from selectedIds', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file], selectedIds: ['f1', 'other'] });

      store.getState().removeFile('f1');

      expect(store.getState().selectedIds).toEqual(['other']);
    });

    it('should not affect other files', () => {
      const file1 = makeMediaFile({ id: 'f1' });
      const file2 = makeMediaFile({ id: 'f2' });
      store.setState({ files: [file1, file2] });

      store.getState().removeFile('f1');

      expect(store.getState().files).toHaveLength(1);
      expect(store.getState().files[0].id).toBe('f2');
    });
  });

  // --- Renaming media files ---

  describe('renameFile', () => {
    it('should rename a file', () => {
      const file = makeMediaFile({ id: 'f1', name: 'old-name.mp4' });
      store.setState({ files: [file] });

      store.getState().renameFile('f1', 'new-name.mp4');

      expect(store.getState().files[0].name).toBe('new-name.mp4');
    });

    it('should not modify other files when renaming', () => {
      const file1 = makeMediaFile({ id: 'f1', name: 'a.mp4' });
      const file2 = makeMediaFile({ id: 'f2', name: 'b.mp4' });
      store.setState({ files: [file1, file2] });

      store.getState().renameFile('f1', 'renamed.mp4');

      expect(store.getState().files[1].name).toBe('b.mp4');
    });
  });

  // --- Folder operations ---

  describe('folder operations', () => {
    it('createFolder should add a folder to state', () => {
      const folder = store.getState().createFolder('My Folder');

      expect(store.getState().folders).toHaveLength(1);
      expect(folder.name).toBe('My Folder');
      expect(folder.parentId).toBeNull();
      expect(folder.isExpanded).toBe(true);
    });

    it('createFolder should support nested folders', () => {
      const parent = store.getState().createFolder('Parent');
      const child = store.getState().createFolder('Child', parent.id);

      expect(child.parentId).toBe(parent.id);
      expect(store.getState().folders).toHaveLength(2);
    });

    it('createFolder should add folder id to expandedFolderIds', () => {
      const folder = store.getState().createFolder('Expanded');

      expect(store.getState().expandedFolderIds).toContain(folder.id);
    });

    it('removeFolder should remove the folder and reparent children', () => {
      const folder = store.getState().createFolder('ToDelete');
      const file = makeMediaFile({ id: 'f1', parentId: folder.id });
      store.setState({ files: [file] });

      store.getState().removeFolder(folder.id);

      expect(store.getState().folders).toHaveLength(0);
      // File should be reparented to null (root)
      expect(store.getState().files[0].parentId).toBeNull();
    });

    it('removeFolder should reparent children to parent folder, not root', () => {
      const parent = store.getState().createFolder('Parent');
      const child = store.getState().createFolder('Child', parent.id);
      const file = makeMediaFile({ id: 'f1', parentId: child.id });
      store.setState({ files: [file] });

      store.getState().removeFolder(child.id);

      // File should be moved to parent, not root
      expect(store.getState().files[0].parentId).toBe(parent.id);
    });

    it('renameFolder should update the folder name', () => {
      const folder = store.getState().createFolder('Original');

      store.getState().renameFolder(folder.id, 'Renamed');

      expect(store.getState().folders[0].name).toBe('Renamed');
    });

    it('toggleFolderExpanded should toggle expanded state', () => {
      const folder = store.getState().createFolder('Toggle');

      // Initially expanded
      expect(store.getState().expandedFolderIds).toContain(folder.id);

      store.getState().toggleFolderExpanded(folder.id);
      expect(store.getState().expandedFolderIds).not.toContain(folder.id);

      store.getState().toggleFolderExpanded(folder.id);
      expect(store.getState().expandedFolderIds).toContain(folder.id);
    });
  });

  // --- Move items to folder ---

  describe('moveToFolder', () => {
    it('should move files into a folder', () => {
      const folder = store.getState().createFolder('Target');
      const file = makeMediaFile({ id: 'f1', parentId: null });
      store.setState({ files: [file] });

      store.getState().moveToFolder(['f1'], folder.id);

      expect(store.getState().files[0].parentId).toBe(folder.id);
    });

    it('should move items back to root', () => {
      const folder = store.getState().createFolder('Folder');
      const file = makeMediaFile({ id: 'f1', parentId: folder.id });
      store.setState({ files: [file] });

      store.getState().moveToFolder(['f1'], null);

      expect(store.getState().files[0].parentId).toBeNull();
    });
  });

  // --- Text item creation ---

  describe('text item creation', () => {
    it('createTextItem should add a text item with defaults', () => {
      const id = store.getState().createTextItem();

      const items = store.getState().textItems;
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(id);
      expect(items[0].type).toBe('text');
      expect(items[0].fontFamily).toBe('Arial');
      expect(items[0].fontSize).toBe(48);
      expect(items[0].duration).toBe(5);
    });

    it('createTextItem should accept a custom name', () => {
      store.getState().createTextItem('Custom Title');

      expect(store.getState().textItems[0].name).toBe('Custom Title');
    });

    it('removeTextItem should remove the text item', () => {
      const id = store.getState().createTextItem();
      expect(store.getState().textItems).toHaveLength(1);

      store.getState().removeTextItem(id);

      expect(store.getState().textItems).toHaveLength(0);
    });
  });

  // --- Solid item creation ---

  describe('solid item creation', () => {
    it('createSolidItem should add a solid item with active comp dimensions', () => {
      const id = store.getState().createSolidItem();

      const items = store.getState().solidItems;
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(id);
      expect(items[0].type).toBe('solid');
      expect(items[0].width).toBe(1920);
      expect(items[0].height).toBe(1080);
      expect(items[0].color).toBe('#ffffff');
      expect(items[0].duration).toBe(5);
    });

    it('createSolidItem should accept a custom color', () => {
      store.getState().createSolidItem('Red Solid', '#ff0000');

      const solid = store.getState().solidItems[0];
      expect(solid.name).toBe('Red Solid');
      expect(solid.color).toBe('#ff0000');
    });

    it('removeSolidItem should remove the solid item', () => {
      const id = store.getState().createSolidItem();
      store.getState().removeSolidItem(id);

      expect(store.getState().solidItems).toHaveLength(0);
    });

    it('updateSolidItem should update color and rename', () => {
      const id = store.getState().createSolidItem('Solid', '#ffffff');

      store.getState().updateSolidItem(id, { color: '#00ff00' });

      const solid = store.getState().solidItems[0];
      expect(solid.color).toBe('#00ff00');
      expect(solid.name).toBe('Solid #00ff00');
    });

    it('updateSolidItem should update dimensions without renaming', () => {
      const id = store.getState().createSolidItem('Solid', '#ffffff');

      store.getState().updateSolidItem(id, { width: 3840, height: 2160 });

      const solid = store.getState().solidItems[0];
      expect(solid.width).toBe(3840);
      expect(solid.height).toBe(2160);
      // Name should stay the same since only dimensions changed
      expect(solid.name).toBe('Solid');
    });
  });

  // --- File deduplication by hash ---

  describe('file deduplication', () => {
    it('should detect duplicate files by fileHash', () => {
      const hash = 'abc123hash';
      const file1 = makeMediaFile({ id: 'f1', fileHash: hash, name: 'clip.mp4' });
      const file2 = makeMediaFile({ id: 'f2', fileHash: hash, name: 'clip-copy.mp4' });

      store.setState({ files: [file1, file2] });

      const { files } = store.getState();
      const duplicates = files.filter(f => f.fileHash === hash);
      expect(duplicates).toHaveLength(2);
    });

    it('should distinguish files with different hashes', () => {
      const file1 = makeMediaFile({ id: 'f1', fileHash: 'hash1' });
      const file2 = makeMediaFile({ id: 'f2', fileHash: 'hash2' });

      store.setState({ files: [file1, file2] });

      const { files } = store.getState();
      const uniqueHashes = new Set(files.map(f => f.fileHash));
      expect(uniqueHashes.size).toBe(2);
    });
  });

  // --- Getter functions ---

  describe('getters', () => {
    it('getItemsByFolder should return items in a specific folder', () => {
      const folder = store.getState().createFolder('MyFolder');
      const file = makeMediaFile({ id: 'f1', parentId: folder.id });
      store.setState({ files: [file] });
      store.getState().createTextItem('InFolder', folder.id);

      const items = store.getState().getItemsByFolder(folder.id);

      // file + text item (folder itself is not a child of itself)
      expect(items).toHaveLength(2);
    });

    it('getItemsByFolder(null) should return root-level items', () => {
      const file = makeMediaFile({ id: 'f1', parentId: null });
      store.setState({ files: [file] });
      store.getState().createFolder('RootFolder');

      const items = store.getState().getItemsByFolder(null);

      // file + folder + the default comp-1
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('getItemById should find a file by id', () => {
      const file = makeMediaFile({ id: 'findme' });
      store.setState({ files: [file] });

      const found = store.getState().getItemById('findme');
      expect(found).toBeDefined();
      expect(found!.id).toBe('findme');
    });

    it('getItemById should return undefined for unknown id', () => {
      expect(store.getState().getItemById('nonexistent')).toBeUndefined();
    });

    it('getFileByName should find a file by name', () => {
      const file = makeMediaFile({ id: 'f1', name: 'special.mp4' });
      store.setState({ files: [file] });

      const found = store.getState().getFileByName('special.mp4');
      expect(found).toBeDefined();
      expect(found!.name).toBe('special.mp4');
    });

    it('getFileByName should return undefined for unknown name', () => {
      expect(store.getState().getFileByName('nonexistent.mp4')).toBeUndefined();
    });

    it('getItemById should find a composition by id', () => {
      const found = store.getState().getItemById('comp-1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('comp-1');
    });

    it('getItemById should find a folder by id', () => {
      const folder = store.getState().createFolder('FindMe');

      const found = store.getState().getItemById(folder.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(folder.id);
    });

    it('getItemById should find a text item by id', () => {
      const id = store.getState().createTextItem('MyText');

      const found = store.getState().getItemById(id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(id);
    });

    it('getItemById should find a solid item by id', () => {
      const id = store.getState().createSolidItem('MySolid');

      const found = store.getState().getItemById(id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(id);
    });

    it('getItemsByFolder should return empty array for empty folder', () => {
      const folder = store.getState().createFolder('EmptyFolder');

      const items = store.getState().getItemsByFolder(folder.id);
      expect(items).toHaveLength(0);
    });

    it('getItemsByFolder should include all item types in a folder', () => {
      const folder = store.getState().createFolder('Mixed');
      const file = makeMediaFile({ id: 'f1', parentId: folder.id });
      store.setState({ files: [file] });
      store.getState().createTextItem('Text', folder.id);
      store.getState().createSolidItem('Solid', '#ff0000', folder.id);

      // Move the default composition into the folder
      store.getState().moveToFolder(['comp-1'], folder.id);

      const items = store.getState().getItemsByFolder(folder.id);
      // file + text + solid + composition
      expect(items).toHaveLength(4);
    });

    it('getItemsByFolder should include nested sub-folders', () => {
      const parent = store.getState().createFolder('Parent');
      store.getState().createFolder('Child', parent.id);

      const items = store.getState().getItemsByFolder(parent.id);
      // Only the child folder (not the parent itself)
      expect(items).toHaveLength(1);
      expect((items[0] as MediaFolder).name).toBe('Child');
    });
  });

  // --- Selection actions ---

  describe('selection actions', () => {
    it('setSelection should replace all selected ids', () => {
      store.getState().setSelection(['a', 'b', 'c']);

      expect(store.getState().selectedIds).toEqual(['a', 'b', 'c']);
    });

    it('setSelection should overwrite previous selection', () => {
      store.getState().setSelection(['a', 'b']);
      store.getState().setSelection(['c']);

      expect(store.getState().selectedIds).toEqual(['c']);
    });

    it('setSelection with empty array should clear selection', () => {
      store.getState().setSelection(['a', 'b']);
      store.getState().setSelection([]);

      expect(store.getState().selectedIds).toEqual([]);
    });

    it('addToSelection should append a new id', () => {
      store.getState().setSelection(['a']);
      store.getState().addToSelection('b');

      expect(store.getState().selectedIds).toEqual(['a', 'b']);
    });

    it('addToSelection should not duplicate an already selected id', () => {
      store.getState().setSelection(['a', 'b']);
      store.getState().addToSelection('a');

      expect(store.getState().selectedIds).toEqual(['a', 'b']);
    });

    it('removeFromSelection should remove a specific id', () => {
      store.getState().setSelection(['a', 'b', 'c']);
      store.getState().removeFromSelection('b');

      expect(store.getState().selectedIds).toEqual(['a', 'c']);
    });

    it('removeFromSelection should be a no-op for unselected id', () => {
      store.getState().setSelection(['a']);
      store.getState().removeFromSelection('z');

      expect(store.getState().selectedIds).toEqual(['a']);
    });

    it('clearSelection should empty selectedIds', () => {
      store.getState().setSelection(['a', 'b', 'c']);
      store.getState().clearSelection();

      expect(store.getState().selectedIds).toEqual([]);
    });

    it('clearSelection on empty selection should be a no-op', () => {
      store.getState().clearSelection();

      expect(store.getState().selectedIds).toEqual([]);
    });
  });

  // --- Label colors ---

  describe('setLabelColor', () => {
    it('should set label color on files', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });

      store.getState().setLabelColor(['f1'], 'red');

      expect(store.getState().files[0].labelColor).toBe('red');
    });

    it('should set label color on multiple items at once', () => {
      const file1 = makeMediaFile({ id: 'f1' });
      const file2 = makeMediaFile({ id: 'f2' });
      store.setState({ files: [file1, file2] });

      store.getState().setLabelColor(['f1', 'f2'], 'blue');

      expect(store.getState().files[0].labelColor).toBe('blue');
      expect(store.getState().files[1].labelColor).toBe('blue');
    });

    it('should set label color on compositions', () => {
      store.getState().setLabelColor(['comp-1'], 'green');

      expect(store.getState().compositions[0].labelColor).toBe('green');
    });

    it('should set label color on folders', () => {
      const folder = store.getState().createFolder('Colored');

      store.getState().setLabelColor([folder.id], 'purple');

      expect(store.getState().folders[0].labelColor).toBe('purple');
    });

    it('should set label color on text items', () => {
      const id = store.getState().createTextItem('Labeled');

      store.getState().setLabelColor([id], 'orange');

      expect(store.getState().textItems[0].labelColor).toBe('orange');
    });

    it('should set label color on solid items', () => {
      const id = store.getState().createSolidItem('Labeled');

      store.getState().setLabelColor([id], 'cyan');

      expect(store.getState().solidItems[0].labelColor).toBe('cyan');
    });

    it('should not affect items not in the id list', () => {
      const file1 = makeMediaFile({ id: 'f1' });
      const file2 = makeMediaFile({ id: 'f2' });
      store.setState({ files: [file1, file2] });

      store.getState().setLabelColor(['f1'], 'red');

      expect(store.getState().files[0].labelColor).toBe('red');
      expect(store.getState().files[1].labelColor).toBeUndefined();
    });

    it('should overwrite existing label color', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });

      store.getState().setLabelColor(['f1'], 'red');
      store.getState().setLabelColor(['f1'], 'yellow');

      expect(store.getState().files[0].labelColor).toBe('yellow');
    });

    it('should support setting label to none', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });

      store.getState().setLabelColor(['f1'], 'red');
      store.getState().setLabelColor(['f1'], 'none');

      expect(store.getState().files[0].labelColor).toBe('none');
    });
  });

  // --- removeFile edge cases ---

  describe('removeFile edge cases', () => {
    it('should be safe to call with non-existent id', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });

      store.getState().removeFile('nonexistent');

      expect(store.getState().files).toHaveLength(1);
    });

    it('should handle removing from empty files list', () => {
      store.getState().removeFile('anything');

      expect(store.getState().files).toHaveLength(0);
    });

    it('should call URL.revokeObjectURL for file url', () => {
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const file = makeMediaFile({ id: 'f1', url: 'blob:http://localhost/test' });
      store.setState({ files: [file] });

      store.getState().removeFile('f1');

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test');
      revokeObjectURL.mockRestore();
    });

    it('should call URL.revokeObjectURL for blob thumbnail url', () => {
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const file = makeMediaFile({ id: 'f1', thumbnailUrl: 'blob:http://localhost/thumb' });
      store.setState({ files: [file] });

      store.getState().removeFile('f1');

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/thumb');
      revokeObjectURL.mockRestore();
    });

    it('should not revoke non-blob thumbnail urls', () => {
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const file = makeMediaFile({ id: 'f1', thumbnailUrl: 'data:image/png;base64,abc' });
      store.setState({ files: [file] });

      store.getState().removeFile('f1');

      // Should only be called for the main url, not the data: thumbnail
      const thumbCall = revokeObjectURL.mock.calls.find(
        c => c[0] === 'data:image/png;base64,abc'
      );
      expect(thumbCall).toBeUndefined();
      revokeObjectURL.mockRestore();
    });

    it('should remove multiple files in sequence', () => {
      const file1 = makeMediaFile({ id: 'f1' });
      const file2 = makeMediaFile({ id: 'f2' });
      const file3 = makeMediaFile({ id: 'f3' });
      store.setState({ files: [file1, file2, file3] });

      store.getState().removeFile('f1');
      store.getState().removeFile('f3');

      expect(store.getState().files).toHaveLength(1);
      expect(store.getState().files[0].id).toBe('f2');
    });
  });

  // --- renameFile edge cases ---

  describe('renameFile edge cases', () => {
    it('should be safe to call with non-existent id', () => {
      const file = makeMediaFile({ id: 'f1', name: 'original.mp4' });
      store.setState({ files: [file] });

      store.getState().renameFile('nonexistent', 'new.mp4');

      expect(store.getState().files[0].name).toBe('original.mp4');
    });

    it('should allow renaming to the same name', () => {
      const file = makeMediaFile({ id: 'f1', name: 'same.mp4' });
      store.setState({ files: [file] });

      store.getState().renameFile('f1', 'same.mp4');

      expect(store.getState().files[0].name).toBe('same.mp4');
    });

    it('should allow renaming to empty string', () => {
      const file = makeMediaFile({ id: 'f1', name: 'test.mp4' });
      store.setState({ files: [file] });

      store.getState().renameFile('f1', '');

      expect(store.getState().files[0].name).toBe('');
    });
  });

  // --- moveToFolder advanced ---

  describe('moveToFolder advanced', () => {
    it('should move compositions into a folder', () => {
      const folder = store.getState().createFolder('Target');

      store.getState().moveToFolder(['comp-1'], folder.id);

      const comp = store.getState().compositions.find(c => c.id === 'comp-1');
      expect(comp!.parentId).toBe(folder.id);
    });

    it('should move folders into other folders', () => {
      const parent = store.getState().createFolder('Parent');
      const child = store.getState().createFolder('Child');

      store.getState().moveToFolder([child.id], parent.id);

      const moved = store.getState().folders.find(f => f.id === child.id);
      expect(moved!.parentId).toBe(parent.id);
    });

    it('should move text items into a folder', () => {
      const folder = store.getState().createFolder('Target');
      const textId = store.getState().createTextItem('MyText');

      store.getState().moveToFolder([textId], folder.id);

      const text = store.getState().textItems.find(t => t.id === textId);
      expect(text!.parentId).toBe(folder.id);
    });

    it('should move solid items into a folder', () => {
      const folder = store.getState().createFolder('Target');
      const solidId = store.getState().createSolidItem('MySolid');

      store.getState().moveToFolder([solidId], folder.id);

      const solid = store.getState().solidItems.find(s => s.id === solidId);
      expect(solid!.parentId).toBe(folder.id);
    });

    it('should move multiple items of different types at once', () => {
      const folder = store.getState().createFolder('Destination');
      const file = makeMediaFile({ id: 'f1', parentId: null });
      store.setState({ files: [file] });
      const textId = store.getState().createTextItem('Text');
      const solidId = store.getState().createSolidItem('Solid');

      store.getState().moveToFolder(['f1', textId, solidId, 'comp-1'], folder.id);

      expect(store.getState().files[0].parentId).toBe(folder.id);
      expect(store.getState().textItems[0].parentId).toBe(folder.id);
      expect(store.getState().solidItems[0].parentId).toBe(folder.id);
      expect(store.getState().compositions.find(c => c.id === 'comp-1')!.parentId).toBe(folder.id);
    });

    it('should not affect items not in the id list', () => {
      const folder = store.getState().createFolder('Target');
      const file1 = makeMediaFile({ id: 'f1', parentId: null });
      const file2 = makeMediaFile({ id: 'f2', parentId: null });
      store.setState({ files: [file1, file2] });

      store.getState().moveToFolder(['f1'], folder.id);

      expect(store.getState().files[0].parentId).toBe(folder.id);
      expect(store.getState().files[1].parentId).toBeNull();
    });
  });

  // --- Folder edge cases ---

  describe('folder edge cases', () => {
    it('removeFolder should reparent compositions to parent', () => {
      const folder = store.getState().createFolder('ToDelete');
      // Move default comp into the folder
      store.getState().moveToFolder(['comp-1'], folder.id);

      store.getState().removeFolder(folder.id);

      const comp = store.getState().compositions.find(c => c.id === 'comp-1');
      expect(comp!.parentId).toBeNull();
    });

    it('removeFolder should remove folder from selectedIds', () => {
      const folder = store.getState().createFolder('Selected');
      store.getState().setSelection([folder.id, 'other']);

      store.getState().removeFolder(folder.id);

      expect(store.getState().selectedIds).toEqual(['other']);
    });

    it('removeFolder should remove folder from expandedFolderIds', () => {
      const folder = store.getState().createFolder('Expanded');
      expect(store.getState().expandedFolderIds).toContain(folder.id);

      store.getState().removeFolder(folder.id);

      expect(store.getState().expandedFolderIds).not.toContain(folder.id);
    });

    it('renameFolder should not affect other folders', () => {
      const folder1 = store.getState().createFolder('First');
      store.getState().createFolder('Second');

      store.getState().renameFolder(folder1.id, 'Renamed');

      expect(store.getState().folders[1].name).toBe('Second');
    });

    it('createFolder should generate unique ids', () => {
      const f1 = store.getState().createFolder('A');
      const f2 = store.getState().createFolder('B');

      expect(f1.id).not.toBe(f2.id);
    });

    it('createFolder should set createdAt timestamp', () => {
      const before = Date.now();
      const folder = store.getState().createFolder('Timestamped');
      const after = Date.now();

      expect(folder.createdAt).toBeGreaterThanOrEqual(before);
      expect(folder.createdAt).toBeLessThanOrEqual(after);
    });

    it('deeply nested folders should work correctly', () => {
      const level1 = store.getState().createFolder('Level 1');
      const level2 = store.getState().createFolder('Level 2', level1.id);
      const level3 = store.getState().createFolder('Level 3', level2.id);

      expect(level3.parentId).toBe(level2.id);
      expect(level2.parentId).toBe(level1.id);
      expect(level1.parentId).toBeNull();

      // Remove middle level - level 3 is not automatically reparented
      // because removeFolder only reparents direct file/composition children
      store.getState().removeFolder(level2.id);
      expect(store.getState().folders).toHaveLength(2);
    });
  });

  // --- Text item advanced ---

  describe('text item advanced', () => {
    it('createTextItem should place in specified parent folder', () => {
      const folder = store.getState().createFolder('TextFolder');
      const id = store.getState().createTextItem('Child Text', folder.id);

      const text = store.getState().textItems.find(t => t.id === id);
      expect(text!.parentId).toBe(folder.id);
    });

    it('createTextItem with null parentId should place at root', () => {
      const id = store.getState().createTextItem('Root Text', null);

      const text = store.getState().textItems.find(t => t.id === id);
      expect(text!.parentId).toBeNull();
    });

    it('createTextItem auto-naming should increment based on count', () => {
      store.getState().createTextItem();
      store.getState().createTextItem();

      expect(store.getState().textItems[0].name).toBe('Text 1');
      expect(store.getState().textItems[1].name).toBe('Text 2');
    });

    it('createTextItem should have default text content', () => {
      const id = store.getState().createTextItem();

      const text = store.getState().textItems.find(t => t.id === id);
      expect(text!.text).toBe('New Text');
      expect(text!.color).toBe('#ffffff');
    });

    it('removeTextItem should not affect other text items', () => {
      const id1 = store.getState().createTextItem('First');
      const id2 = store.getState().createTextItem('Second');

      store.getState().removeTextItem(id1);

      expect(store.getState().textItems).toHaveLength(1);
      expect(store.getState().textItems[0].id).toBe(id2);
    });

    it('removeTextItem should be safe with non-existent id', () => {
      store.getState().createTextItem('Only');

      store.getState().removeTextItem('nonexistent');

      expect(store.getState().textItems).toHaveLength(1);
    });
  });

  // --- Solid item advanced ---

  describe('solid item advanced', () => {
    it('createSolidItem should place in specified parent folder', () => {
      const folder = store.getState().createFolder('SolidFolder');
      const id = store.getState().createSolidItem('Child Solid', '#000', folder.id);

      const solid = store.getState().solidItems.find(s => s.id === id);
      expect(solid!.parentId).toBe(folder.id);
    });

    it('createSolidItem auto-naming should increment based on count', () => {
      store.getState().createSolidItem();
      store.getState().createSolidItem();

      expect(store.getState().solidItems[0].name).toBe('Solid 1');
      expect(store.getState().solidItems[1].name).toBe('Solid 2');
    });

    it('createSolidItem should fall back to 1920x1080 when no active composition', () => {
      // Set no active composition
      store.setState({ activeCompositionId: null });

      const id = store.getState().createSolidItem();

      const solid = store.getState().solidItems.find(s => s.id === id);
      expect(solid!.width).toBe(1920);
      expect(solid!.height).toBe(1080);
    });

    it('createSolidItem should use custom comp dimensions', () => {
      // Change active composition dimensions
      store.setState({
        compositions: [{
          id: 'comp-4k',
          name: '4K Comp',
          type: 'composition' as const,
          parentId: null,
          createdAt: Date.now(),
          width: 3840,
          height: 2160,
          frameRate: 60,
          duration: 120,
          backgroundColor: '#000000',
        }],
        activeCompositionId: 'comp-4k',
      });

      const id = store.getState().createSolidItem();

      const solid = store.getState().solidItems.find(s => s.id === id);
      expect(solid!.width).toBe(3840);
      expect(solid!.height).toBe(2160);
    });

    it('updateSolidItem should handle color and dimensions together', () => {
      const id = store.getState().createSolidItem('Solid', '#ffffff');

      store.getState().updateSolidItem(id, { color: '#ff0000', width: 800, height: 600 });

      const solid = store.getState().solidItems[0];
      expect(solid.color).toBe('#ff0000');
      expect(solid.width).toBe(800);
      expect(solid.height).toBe(600);
      expect(solid.name).toBe('Solid #ff0000');
    });

    it('updateSolidItem should not affect other solid items', () => {
      const id1 = store.getState().createSolidItem('A', '#111');
      store.getState().createSolidItem('B', '#222');

      store.getState().updateSolidItem(id1, { color: '#999' });

      expect(store.getState().solidItems[1].color).toBe('#222');
      expect(store.getState().solidItems[1].name).toBe('B');
    });

    it('removeSolidItem should not affect other solid items', () => {
      const id1 = store.getState().createSolidItem('First');
      const id2 = store.getState().createSolidItem('Second');

      store.getState().removeSolidItem(id1);

      expect(store.getState().solidItems).toHaveLength(1);
      expect(store.getState().solidItems[0].id).toBe(id2);
    });
  });

  // --- getOrCreateTextFolder ---

  describe('getOrCreateTextFolder', () => {
    it('should create a Text folder if none exists', () => {
      const folderId = store.getState().getOrCreateTextFolder();

      expect(folderId).toBeDefined();
      const folder = store.getState().folders.find(f => f.id === folderId);
      expect(folder).toBeDefined();
      expect(folder!.name).toBe('Text');
      expect(folder!.parentId).toBeNull();
    });

    it('should return existing Text folder on subsequent calls', () => {
      const id1 = store.getState().getOrCreateTextFolder();
      const id2 = store.getState().getOrCreateTextFolder();

      expect(id1).toBe(id2);
      // Should only have one Text folder
      const textFolders = store.getState().folders.filter(f => f.name === 'Text');
      expect(textFolders).toHaveLength(1);
    });

    it('should not match a nested folder named Text', () => {
      const parent = store.getState().createFolder('Parent');
      store.getState().createFolder('Text', parent.id);

      // getOrCreateTextFolder looks for root-level "Text" folder
      const folderId = store.getState().getOrCreateTextFolder();

      const folder = store.getState().folders.find(f => f.id === folderId);
      expect(folder!.parentId).toBeNull();
      // Should have created a new root-level "Text" folder
      const rootTextFolders = store.getState().folders.filter(
        f => f.name === 'Text' && f.parentId === null
      );
      expect(rootTextFolders).toHaveLength(1);
    });
  });

  // --- getOrCreateSolidFolder ---

  describe('getOrCreateSolidFolder', () => {
    it('should create a Solids folder if none exists', () => {
      const folderId = store.getState().getOrCreateSolidFolder();

      const folder = store.getState().folders.find(f => f.id === folderId);
      expect(folder).toBeDefined();
      expect(folder!.name).toBe('Solids');
      expect(folder!.parentId).toBeNull();
    });

    it('should return existing Solids folder on subsequent calls', () => {
      const id1 = store.getState().getOrCreateSolidFolder();
      const id2 = store.getState().getOrCreateSolidFolder();

      expect(id1).toBe(id2);
      const solidFolders = store.getState().folders.filter(f => f.name === 'Solids');
      expect(solidFolders).toHaveLength(1);
    });
  });

  // --- Media file types ---

  describe('media file types', () => {
    it('should support audio type files', () => {
      const audio = makeMediaFile({
        id: 'a1',
        name: 'track.mp3',
        type: 'audio',
        width: undefined,
        height: undefined,
        duration: 180,
      });
      store.setState({ files: [audio] });

      expect(store.getState().files[0].type).toBe('audio');
      expect(store.getState().files[0].duration).toBe(180);
    });

    it('should support image type files', () => {
      const image = makeMediaFile({
        id: 'i1',
        name: 'photo.jpg',
        type: 'image',
        duration: undefined,
      });
      store.setState({ files: [image] });

      expect(store.getState().files[0].type).toBe('image');
    });

    it('should store metadata fields (fps, codec, container, bitrate)', () => {
      const file = makeMediaFile({
        id: 'f1',
        fps: 29.97,
        codec: 'H.264',
        audioCodec: 'AAC',
        container: 'MP4',
        bitrate: 8000000,
        hasAudio: true,
      });
      store.setState({ files: [file] });

      const stored = store.getState().files[0];
      expect(stored.fps).toBe(29.97);
      expect(stored.codec).toBe('H.264');
      expect(stored.audioCodec).toBe('AAC');
      expect(stored.container).toBe('MP4');
      expect(stored.bitrate).toBe(8000000);
      expect(stored.hasAudio).toBe(true);
    });

    it('should store proxy-related fields', () => {
      const file = makeMediaFile({
        id: 'f1',
        proxyStatus: 'ready',
        proxyProgress: 100,
        proxyFrameCount: 300,
        proxyFps: 30,
        hasProxyAudio: true,
        proxyVideoUrl: 'blob:http://localhost/proxy',
      });
      store.setState({ files: [file] });

      const stored = store.getState().files[0];
      expect(stored.proxyStatus).toBe('ready');
      expect(stored.proxyProgress).toBe(100);
      expect(stored.proxyFrameCount).toBe(300);
      expect(stored.proxyFps).toBe(30);
      expect(stored.hasProxyAudio).toBe(true);
      expect(stored.proxyVideoUrl).toBe('blob:http://localhost/proxy');
    });

    it('should store file system access fields', () => {
      const file = makeMediaFile({
        id: 'f1',
        hasFileHandle: true,
        filePath: 'video.mp4',
        absolutePath: 'C:/Videos/video.mp4',
        projectPath: 'RAW/video.mp4',
      });
      store.setState({ files: [file] });

      const stored = store.getState().files[0];
      expect(stored.hasFileHandle).toBe(true);
      expect(stored.filePath).toBe('video.mp4');
      expect(stored.absolutePath).toBe('C:/Videos/video.mp4');
      expect(stored.projectPath).toBe('RAW/video.mp4');
    });
  });

  // --- Combined operations / integration ---

  describe('combined operations', () => {
    it('creating a folder and moving all items into it should update getItemsByFolder', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });
      const textId = store.getState().createTextItem('Text');
      const solidId = store.getState().createSolidItem('Solid');
      const folder = store.getState().createFolder('All Items');

      store.getState().moveToFolder(['f1', textId, solidId], folder.id);

      const folderItems = store.getState().getItemsByFolder(folder.id);
      expect(folderItems).toHaveLength(3);

      const rootItems = store.getState().getItemsByFolder(null);
      // Only the folder and default comp at root
      const rootItemIds = rootItems.map(i => i.id);
      expect(rootItemIds).toContain(folder.id);
      expect(rootItemIds).toContain('comp-1');
      expect(rootItemIds).not.toContain('f1');
    });

    it('removing a file should not break folder contents listing', () => {
      const folder = store.getState().createFolder('Target');
      const file1 = makeMediaFile({ id: 'f1', parentId: folder.id });
      const file2 = makeMediaFile({ id: 'f2', parentId: folder.id });
      store.setState({ files: [file1, file2] });

      store.getState().removeFile('f1');

      const items = store.getState().getItemsByFolder(folder.id);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('f2');
    });

    it('selecting, labeling, then clearing should leave items with labels but no selection', () => {
      const file = makeMediaFile({ id: 'f1' });
      store.setState({ files: [file] });

      store.getState().setSelection(['f1']);
      store.getState().setLabelColor(['f1'], 'red');
      store.getState().clearSelection();

      expect(store.getState().selectedIds).toEqual([]);
      expect(store.getState().files[0].labelColor).toBe('red');
    });

    it('removing a folder should not remove its children, only reparent them', () => {
      const folder = store.getState().createFolder('Container');
      const file1 = makeMediaFile({ id: 'f1', parentId: folder.id });
      const file2 = makeMediaFile({ id: 'f2', parentId: folder.id });
      store.setState({ files: [file1, file2] });

      store.getState().removeFolder(folder.id);

      expect(store.getState().files).toHaveLength(2);
      expect(store.getState().files[0].parentId).toBeNull();
      expect(store.getState().files[1].parentId).toBeNull();
    });
  });
});
