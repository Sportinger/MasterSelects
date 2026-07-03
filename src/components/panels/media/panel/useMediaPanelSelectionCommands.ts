import { useCallback, useEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react';
import { Logger } from '../../../../services/logger';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { thumbnailCacheService } from '../../../../services/thumbnailCacheService';
import type { MediaFile, ProjectItem, useMediaStore } from '../../../../stores/mediaStore';
import type { MediaPanelContextMenu } from '../context/types';
import { collectDroppedMediaFiles, importDroppedMediaFiles } from '../dropImport';
import type { MediaPanelViewMode } from './types';

const log = Logger.create('MediaPanel');

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

interface FloatingText {
  id: number;
  text: string;
  x: number;
  y: number;
}

interface UseMediaPanelSelectionCommandsInput {
  selectedIds: string[];
  viewMode: MediaPanelViewMode;
  setGridFolderId: Dispatch<SetStateAction<string | null>>;
  setContextMenu: Dispatch<SetStateAction<MediaPanelContextMenu | null>>;
  closeContextMenu: () => void;
  setSelectedMediaBoardAnnotationId: (id: string | null) => void;
  setGenerativeTrayExpanded: Dispatch<SetStateAction<boolean>>;
  getActiveParentId: () => string | null;
  getAiReferenceMediaFileIds: () => string[];
  updateAiReferenceMediaFileIds: (ids: string[]) => void;
  setSelection: MediaStoreState['setSelection'];
  addToSelection: MediaStoreState['addToSelection'];
  removeFromSelection: MediaStoreState['removeFromSelection'];
  toggleFolderExpanded: MediaStoreState['toggleFolderExpanded'];
  openCompositionTab: MediaStoreState['openCompositionTab'];
  reloadFile: MediaStoreState['reloadFile'];
  setSourceMonitorFile: MediaStoreState['setSourceMonitorFile'];
  ensureFileThumbnail: MediaStoreState['ensureFileThumbnail'];
  generateAudioProxy: MediaStoreState['generateAudioProxy'];
  generateMediaWaveform: MediaStoreState['generateMediaWaveform'];
  generateMediaSpectrogram: MediaStoreState['generateMediaSpectrogram'];
  copyMediaItems: MediaStoreState['copyMediaItems'];
  duplicateMediaItems: MediaStoreState['duplicateMediaItems'];
  pasteMediaItems: MediaStoreState['pasteMediaItems'];
  hasMediaClipboard: MediaStoreState['hasMediaClipboard'];
  folders: MediaStoreState['folders'];
  createFolder: MediaStoreState['createFolder'];
  importFiles: MediaStoreState['importFiles'];
  importFilesWithHandles: MediaStoreState['importFilesWithHandles'];
  handleDelete: () => Promise<void>;
}

function appendUniqueIds(current: string[], next: string[]): string[] {
  const seen = new Set(current);
  const result = [...current];

  for (const id of next) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

function isEditableElement(element: HTMLElement | null): boolean {
  return Boolean(
    element &&
    (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable),
  );
}

function isMediaPanelPasteTarget(root: HTMLDivElement | null, pointer: { x: number; y: number }): boolean {
  if (!root) return false;
  if (root.matches(':hover')) return true;
  if (document.activeElement && root.contains(document.activeElement)) return true;

  const rect = root.getBoundingClientRect();
  return pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
}

function getClipboardImageExtension(type: string): string {
  const subtype = type.split('/')[1]?.split('+')[0] || 'png';
  return subtype === 'jpeg' ? 'jpg' : subtype;
}

async function readClipboardImageFiles(): Promise<File[]> {
  if (!navigator.clipboard?.read) return [];

  const clipboardItems = await navigator.clipboard.read();
  const files: File[] = [];

  for (const item of clipboardItems) {
    for (const type of item.types) {
      if (!type.startsWith('image/')) continue;
      const blob = await item.getType(type);
      const extension = getClipboardImageExtension(type);
      files.push(new File([blob], `clipboard-${Date.now()}.${extension}`, {
        type,
        lastModified: Date.now(),
      }));
    }
  }

  return files;
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

async function regenerateTimelineSourceThumbnails(mediaFile: MediaFile): Promise<void> {
  if (mediaFile.type !== 'video') return;

  const createdUrl = mediaFile.file ? URL.createObjectURL(mediaFile.file) : null;
  const sourceUrl = createdUrl ?? mediaFile.url;
  if (!sourceUrl) return;

  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('Video metadata timeout'));
      }, 5000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('Video metadata failed'));
      };

      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });

    const duration = mediaFile.duration || video.duration || 0;
    if (duration > 0) {
      await thumbnailCacheService.clearSource(mediaFile.id);
      await thumbnailCacheService.generateForSource(mediaFile.id, video, duration, mediaFile.fileHash);
    }
  } finally {
    video.pause();
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // Ignore detached video cleanup errors.
    }
    if (createdUrl) {
      URL.revokeObjectURL(createdUrl);
    }
  }
}

export function useMediaPanelSelectionCommands({
  selectedIds,
  viewMode,
  setGridFolderId,
  setContextMenu,
  closeContextMenu,
  setSelectedMediaBoardAnnotationId,
  setGenerativeTrayExpanded,
  getActiveParentId,
  getAiReferenceMediaFileIds,
  updateAiReferenceMediaFileIds,
  setSelection,
  addToSelection,
  removeFromSelection,
  toggleFolderExpanded,
  openCompositionTab,
  reloadFile,
  setSourceMonitorFile,
  ensureFileThumbnail,
  generateAudioProxy,
  generateMediaWaveform,
  generateMediaSpectrogram,
  copyMediaItems,
  duplicateMediaItems,
  pasteMediaItems,
  hasMediaClipboard,
  folders,
  createFolder,
  importFiles,
  importFilesWithHandles,
  handleDelete,
}: UseMediaPanelSelectionCommandsInput): {
  mediaPanelRootRef: { current: HTMLDivElement | null };
  floatingTexts: FloatingText[];
  handleMediaPanelMouseMove: (e: ReactMouseEvent) => void;
  handleItemClick: (id: string, e: ReactMouseEvent) => void;
  handleItemDoubleClick: (item: ProjectItem) => Promise<void>;
  handleContextMenu: (
    e: ReactMouseEvent,
    itemId?: string,
    parentId?: string | null,
    boardPosition?: { x: number; y: number },
  ) => void;
  handleToggleAiPromptReferences: (mediaFileIds: string[]) => void;
  handleCopyPrompt: (prompt: string) => void;
  handleRegenerateMediaThumbnails: (mediaFile: MediaFile) => void;
  handleRegenerateMediaAudioProxy: (mediaFile: MediaFile, force: boolean) => void;
  handleRegenerateMediaWaveform: (mediaFile: MediaFile) => void;
  handleRegenerateMediaSpectrogram: (mediaFile: MediaFile) => void;
  handleCopySelected: () => void;
  handleDuplicateSelected: () => void;
  handlePasteItems: () => void;
} {
  const mediaPanelRootRef = useRef<HTMLDivElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number }>({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  });
  const floatingTextIdRef = useRef(0);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);

  const showFloatingText = useCallback((text: string) => {
    const { x, y } = lastPointerRef.current;
    const id = ++floatingTextIdRef.current;
    setFloatingTexts((prev) => [...prev, { id, text, x, y }]);
    window.setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((entry) => entry.id !== id));
    }, 900);
  }, []);

  const handleMediaPanelMouseMove = useCallback((e: ReactMouseEvent) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleItemClick = useCallback((id: string, e: ReactMouseEvent) => {
    setSelectedMediaBoardAnnotationId(null);
    if (e.ctrlKey || e.metaKey) {
      if (selectedIds.includes(id)) {
        removeFromSelection(id);
      } else {
        addToSelection(id);
      }
    } else if (e.shiftKey) {
      addToSelection(id);
    } else {
      setSelection([id]);
    }
  }, [addToSelection, removeFromSelection, selectedIds, setSelectedMediaBoardAnnotationId, setSelection]);

  const handleItemDoubleClick = useCallback(async (item: ProjectItem) => {
    if ('isExpanded' in item) {
      if (viewMode === 'icons') {
        setGridFolderId(item.id);
      } else {
        toggleFolderExpanded(item.id);
      }
    } else if (item.type === 'composition') {
      openCompositionTab(item.id);
    } else if ((item.type === 'video' || item.type === 'image' || item.type === 'audio') && 'file' in item && (item as MediaFile).file) {
      setSourceMonitorFile(item.id);
    } else if ('file' in item && mediaNeedsRelink(item as MediaFile)) {
      const success = await reloadFile(item.id);
      if (success) {
        log.info('File reloaded successfully');
      }
    }
  }, [openCompositionTab, reloadFile, setGridFolderId, setSourceMonitorFile, toggleFolderExpanded, viewMode]);

  const handleContextMenu = useCallback((
    e: ReactMouseEvent,
    itemId?: string,
    parentId?: string | null,
    boardPosition?: { x: number; y: number },
  ) => {
    e.preventDefault();
    if (itemId && !selectedIds.includes(itemId)) {
      if (e.ctrlKey || e.metaKey) {
        addToSelection(itemId);
      } else {
        setSelection([itemId]);
      }
    }
    if (itemId) {
      setSelectedMediaBoardAnnotationId(null);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, itemId, parentId, boardPosition });
  }, [addToSelection, selectedIds, setContextMenu, setSelectedMediaBoardAnnotationId, setSelection]);

  const handleToggleAiPromptReferences = useCallback((mediaFileIds: string[]) => {
    if (mediaFileIds.length === 0) {
      closeContextMenu();
      return;
    }

    const currentReferences = getAiReferenceMediaFileIds();
    const allSelectedReferences = mediaFileIds.every((id) => currentReferences.includes(id));
    const nextReferences = allSelectedReferences
      ? currentReferences.filter((id) => !mediaFileIds.includes(id))
      : appendUniqueIds(currentReferences, mediaFileIds);

    updateAiReferenceMediaFileIds(nextReferences);
    setGenerativeTrayExpanded(true);
    closeContextMenu();
  }, [closeContextMenu, getAiReferenceMediaFileIds, setGenerativeTrayExpanded, updateAiReferenceMediaFileIds]);

  const handleCopyPrompt = useCallback((prompt: string) => {
    void copyTextToClipboard(prompt).then(() => {
      showFloatingText('Copied');
    }).catch((error) => {
      log.warn('Failed to copy generation prompt', { error });
      showFloatingText('Clipboard blocked');
    }).finally(() => {
      closeContextMenu();
    });
  }, [closeContextMenu, showFloatingText]);

  const handleRegenerateMediaThumbnails = useCallback((mediaFile: MediaFile) => {
    void (async () => {
      await ensureFileThumbnail(mediaFile.id, { force: true });
      await regenerateTimelineSourceThumbnails(mediaFile);
    })().catch((error) => {
      log.warn('Failed to regenerate media thumbnails', {
        id: mediaFile.id,
        name: mediaFile.name,
        error,
      });
    });
    closeContextMenu();
  }, [closeContextMenu, ensureFileThumbnail]);

  const handleRegenerateMediaAudioProxy = useCallback((mediaFile: MediaFile, force: boolean) => {
    void generateAudioProxy(mediaFile.id, { force });
    closeContextMenu();
  }, [closeContextMenu, generateAudioProxy]);

  const handleRegenerateMediaWaveform = useCallback((mediaFile: MediaFile) => {
    void generateMediaWaveform(mediaFile.id, { force: true });
    closeContextMenu();
  }, [closeContextMenu, generateMediaWaveform]);

  const handleRegenerateMediaSpectrogram = useCallback((mediaFile: MediaFile) => {
    void generateMediaSpectrogram(mediaFile.id, { force: true });
    closeContextMenu();
  }, [closeContextMenu, generateMediaSpectrogram]);

  const handleCopySelected = useCallback(() => {
    if (selectedIds.length > 0) {
      copyMediaItems([...selectedIds]);
      showFloatingText('Copied');
    }
    closeContextMenu();
  }, [closeContextMenu, copyMediaItems, selectedIds, showFloatingText]);

  const handleDuplicateSelected = useCallback(() => {
    if (selectedIds.length > 0) {
      duplicateMediaItems([...selectedIds]);
      showFloatingText('Duplicated');
    }
    closeContextMenu();
  }, [closeContextMenu, duplicateMediaItems, selectedIds, showFloatingText]);

  const handlePasteItems = useCallback(() => {
    const pasted = pasteMediaItems(getActiveParentId());
    if (pasted.length > 0) showFloatingText('Pasted');
    closeContextMenu();
  }, [closeContextMenu, getActiveParentId, pasteMediaItems, showFloatingText]);

  const importClipboardFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return false;

    await importDroppedMediaFiles(
      files.map((file) => ({ file, folderSegments: [] })),
      getActiveParentId(),
      {
        createFolder,
        existingFolders: folders,
        importFiles,
        importFilesWithHandles,
      },
    );
    showFloatingText('Imported');
    closeContextMenu();
    return true;
  }, [
    closeContextMenu,
    createFolder,
    folders,
    getActiveParentId,
    importFiles,
    importFilesWithHandles,
    showFloatingText,
  ]);

  const pasteMediaPanelItems = useCallback(() => {
    const pasted = pasteMediaItems(getActiveParentId());
    if (pasted.length > 0) showFloatingText('Pasted');
    closeContextMenu();
  }, [closeContextMenu, getActiveParentId, pasteMediaItems, showFloatingText]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) return;
      const root = mediaPanelRootRef.current;
      if (!isMediaPanelPasteTarget(root, lastPointerRef.current)) return;
      const active = document.activeElement as HTMLElement | null;
      if (isEditableElement(active)) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        void handleDelete();
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        copyMediaItems([...selectedIds]);
        showFloatingText('Copied');
      } else if (key === 'v') {
        e.preventDefault();
        e.stopImmediatePropagation();
        void (async () => {
          if (await importClipboardFiles(await readClipboardImageFiles())) return;
          if (hasMediaClipboard()) pasteMediaPanelItems();
          else showFloatingText('No clipboard image');
        })().catch((error) => {
          log.warn('Failed to read image clipboard for media panel paste', { error });
          showFloatingText('Clipboard blocked');
          if (hasMediaClipboard()) pasteMediaPanelItems();
        });
      } else if (key === 'd') {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        duplicateMediaItems([...selectedIds]);
        showFloatingText('Duplicated');
      }
    };
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [
    copyMediaItems,
    duplicateMediaItems,
    handleDelete,
    hasMediaClipboard,
    importClipboardFiles,
    pasteMediaPanelItems,
    selectedIds,
    showFloatingText,
  ]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const root = mediaPanelRootRef.current;
      if (!isMediaPanelPasteTarget(root, lastPointerRef.current)) return;
      const active = document.activeElement as HTMLElement | null;
      if (isEditableElement(active)) return;

      const clipboardData = event.clipboardData;
      const hasClipboardFiles = Boolean(
        clipboardData &&
        (clipboardData.files.length > 0 || Array.from(clipboardData.items).some((item) => item.kind === 'file')),
      );

      event.preventDefault();
      event.stopImmediatePropagation();

      void (async () => {
        if (clipboardData && hasClipboardFiles) {
          const pastedFiles = await collectDroppedMediaFiles(clipboardData);
          if (pastedFiles.length > 0 && await importClipboardFiles(pastedFiles.map((record) => record.file))) return;
        }

        if (await importClipboardFiles(await readClipboardImageFiles())) return;

        pasteMediaPanelItems();
      })().catch((error) => {
        log.warn('Failed to paste media panel clipboard content', { error });
        showFloatingText('Clipboard blocked');
      });
    };

    document.addEventListener('paste', handlePaste, { capture: true });
    return () => document.removeEventListener('paste', handlePaste, { capture: true });
  }, [
    importClipboardFiles,
    pasteMediaPanelItems,
    showFloatingText,
  ]);

  return {
    mediaPanelRootRef,
    floatingTexts,
    handleMediaPanelMouseMove,
    handleItemClick,
    handleItemDoubleClick,
    handleContextMenu,
    handleToggleAiPromptReferences,
    handleCopyPrompt,
    handleRegenerateMediaThumbnails,
    handleRegenerateMediaAudioProxy,
    handleRegenerateMediaWaveform,
    handleRegenerateMediaSpectrogram,
    handleCopySelected,
    handleDuplicateSelected,
    handlePasteItems,
  };
}
