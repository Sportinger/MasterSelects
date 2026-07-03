import { useCallback, useMemo } from 'react';
import {
  MEDIA_CLASSIC_ROW_HEIGHT as CLASSIC_ROW_HEIGHT,
  buildClassicMediaRows,
  getClassicMediaColumnWidths,
  getClassicVisibleRange,
} from '../list/classicListPlanning';
import type { MediaClassicDynamicColumnWidths, MediaClassicListRowData } from '../list/types';
import { isImportedMediaFileItem } from '../itemTypeGuards';
import type {
  CameraItem,
  Composition,
  MathSceneItem,
  MediaFile,
  MediaFolder,
  MeshItem,
  MotionShapeItem,
  ProjectItem,
  SignalAssetItem,
  SolidItem,
  SplatEffectorItem,
  TextItem,
} from '../../../../stores/mediaStore';
import { isUserVisibleComposition } from '../../../../stores/mediaStore/compositionVisibility';

interface MediaSearchToken {
  value: string;
  glob?: RegExp;
}

interface MediaPanelProjectItemsInput {
  files: MediaFile[];
  compositions: Composition[];
  folders: MediaFolder[];
  textItems: TextItem[];
  solidItems: SolidItem[];
  meshItems: MeshItem[];
  cameraItems: CameraItem[];
  splatEffectorItems: SplatEffectorItem[];
  mathSceneItems: MathSceneItem[];
  motionShapeItems: MotionShapeItem[];
  signalAssets: SignalAssetItem[];
  expandedFolderIds: string[];
  mediaSearchQuery: string;
  gridFolderId: string | null;
  classicListViewport: { scrollTop: number; height: number };
  sortItems: (items: ProjectItem[]) => ProjectItem[];
}

export interface MediaPanelProjectItemsState {
  allProjectItems: ProjectItem[];
  allProjectItemsById: Map<string, ProjectItem>;
  totalItems: number;
  isMediaSearchActive: boolean;
  mediaSearchVisibleItemIds: Set<string> | null;
  mediaSearchResultCount: number;
  getItemsForParent: (parentId: string | null) => ProjectItem[];
  classicRows: MediaClassicListRowData[];
  dynamicMediaColumnWidths: MediaClassicDynamicColumnWidths;
  classicVisibleRows: MediaClassicListRowData[];
  classicTopSpacerHeight: number;
  classicBottomSpacerHeight: number;
  gridItems: ProjectItem[];
  gridBreadcrumb: Array<{ id: string | null; name: string }>;
}

function isSignalAssetItem(item: ProjectItem): item is SignalAssetItem {
  return 'type' in item && item.type === 'signal';
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (const char of pattern) {
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += escapeRegExp(char);
    }
  }
  source += '$';
  return new RegExp(source, 'i');
}

function createMediaSearchTokens(query: string): MediaSearchToken[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({
      value: token.toLowerCase(),
      glob: /[*?]/.test(token) ? globToRegExp(token) : undefined,
    }));
}

function getProjectItemSearchValues(item: ProjectItem): string[] {
  const values = [item.name, 'isExpanded' in item ? 'folder' : ''];
  if ('type' in item) {
    values.push(item.type);
  }

  if (isImportedMediaFileItem(item)) {
    values.push(
      item.file?.name ?? '',
      item.file?.type ?? '',
      item.codec ?? '',
      item.audioCodec ?? '',
      item.container ?? '',
      item.filePath ?? '',
      item.absolutePath ?? '',
      item.projectPath ?? '',
    );
  } else if (isSignalAssetItem(item)) {
    values.push(
      item.asset.source.fileName ?? '',
      item.asset.source.mimeType ?? '',
      item.asset.source.extension ?? '',
      item.providerId ?? '',
      ...item.signalKinds,
    );
  }

  return values.filter(Boolean);
}

function projectItemMatchesMediaSearch(item: ProjectItem, tokens: MediaSearchToken[]): boolean {
  if (tokens.length === 0) return true;

  const values = getProjectItemSearchValues(item);
  const searchableText = values.join(' ').toLowerCase();

  return tokens.every((token) => {
    if (token.glob) {
      return values.some((value) => token.glob!.test(value));
    }
    return searchableText.includes(token.value);
  });
}

function buildMediaPanelProjectListItems({
  folders,
  compositions,
  textItems,
  solidItems,
  meshItems,
  cameraItems,
  splatEffectorItems,
  mathSceneItems,
  motionShapeItems,
  signalAssets,
  files,
}: Pick<MediaPanelProjectItemsInput,
  | 'folders'
  | 'compositions'
  | 'textItems'
  | 'solidItems'
  | 'meshItems'
  | 'cameraItems'
  | 'splatEffectorItems'
  | 'mathSceneItems'
  | 'motionShapeItems'
  | 'signalAssets'
  | 'files'
>): ProjectItem[] {
  return [
    ...folders,
    ...compositions.filter(isUserVisibleComposition),
    ...textItems,
    ...solidItems,
    ...meshItems,
    ...cameraItems,
    ...splatEffectorItems,
    ...mathSceneItems,
    ...motionShapeItems,
    ...signalAssets,
    ...files,
  ];
}

function buildGridBreadcrumb(
  isMediaSearchActive: boolean,
  gridFolderId: string | null,
  folders: MediaFolder[],
): Array<{ id: string | null; name: string }> {
  if (isMediaSearchActive || !gridFolderId) {
    return [];
  }

  const path: Array<{ id: string; name: string }> = [];
  let current = folders.find(f => f.id === gridFolderId);
  while (current) {
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
  }

  return [
    { id: null, name: '/' },
    ...path,
  ];
}

export function useMediaPanelProjectItems({
  files,
  compositions,
  folders,
  textItems,
  solidItems,
  meshItems,
  cameraItems,
  splatEffectorItems,
  mathSceneItems,
  motionShapeItems,
  signalAssets,
  expandedFolderIds,
  mediaSearchQuery,
  gridFolderId,
  classicListViewport,
  sortItems,
}: MediaPanelProjectItemsInput): MediaPanelProjectItemsState {
  const allProjectItems = useMemo<ProjectItem[]>(() => ([
    ...files,
    ...compositions.filter(isUserVisibleComposition),
    ...folders,
    ...textItems,
    ...solidItems,
    ...meshItems,
    ...cameraItems,
    ...splatEffectorItems,
    ...mathSceneItems,
    ...motionShapeItems,
    ...signalAssets,
  ]), [files, compositions, folders, textItems, solidItems, meshItems, cameraItems, splatEffectorItems, mathSceneItems, motionShapeItems, signalAssets]);

  const projectListItems = useMemo<ProjectItem[]>(() => buildMediaPanelProjectListItems({
    folders,
    compositions,
    textItems,
    solidItems,
    meshItems,
    cameraItems,
    splatEffectorItems,
    mathSceneItems,
    motionShapeItems,
    signalAssets,
    files,
  }), [folders, compositions, textItems, solidItems, meshItems, cameraItems, splatEffectorItems, mathSceneItems, motionShapeItems, signalAssets, files]);

  const allProjectItemsById = useMemo(() => new Map(allProjectItems.map((item) => [item.id, item])), [allProjectItems]);
  const totalItems = allProjectItems.length;
  const mediaSearchTokens = useMemo(() => createMediaSearchTokens(mediaSearchQuery), [mediaSearchQuery]);
  const isMediaSearchActive = mediaSearchTokens.length > 0;
  const mediaSearchDirectMatches = useMemo(() => (
    isMediaSearchActive
      ? projectListItems.filter((item) => projectItemMatchesMediaSearch(item, mediaSearchTokens))
      : projectListItems
  ), [isMediaSearchActive, mediaSearchTokens, projectListItems]);
  const mediaSearchDirectMatchIds = useMemo(() => new Set(mediaSearchDirectMatches.map((item) => item.id)), [mediaSearchDirectMatches]);
  const mediaSearchVisibleItemIds = useMemo(() => {
    if (!isMediaSearchActive) return null;

    const visibleIds = new Set(mediaSearchDirectMatchIds);
    mediaSearchDirectMatches.forEach((item) => {
      let parentId = item.parentId ?? null;
      while (parentId) {
        visibleIds.add(parentId);
        parentId = allProjectItemsById.get(parentId)?.parentId ?? null;
      }
    });
    return visibleIds;
  }, [allProjectItemsById, isMediaSearchActive, mediaSearchDirectMatchIds, mediaSearchDirectMatches]);
  const mediaSearchResultCount = isMediaSearchActive ? mediaSearchDirectMatches.length : totalItems;

  const projectItemsByParentId = useMemo(() => {
    const itemsByParentId = new Map<string | null, ProjectItem[]>();
    const append = (item: ProjectItem) => {
      if (mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id)) return;

      const parentId = item.parentId ?? null;
      const items = itemsByParentId.get(parentId);
      if (items) {
        items.push(item);
      } else {
        itemsByParentId.set(parentId, [item]);
      }
    };

    projectListItems.forEach(append);

    return itemsByParentId;
  }, [mediaSearchVisibleItemIds, projectListItems]);

  const getItemsForParent = useCallback(
    (parentId: string | null) => projectItemsByParentId.get(parentId) ?? [],
    [projectItemsByParentId],
  );

  const classicExpandedFolderIdSet = useMemo(() => new Set(expandedFolderIds), [expandedFolderIds]);
  const classicRows = useMemo(() => buildClassicMediaRows({
    getItemsForParent,
    expandedFolderIds: classicExpandedFolderIdSet,
    forceExpandFolders: isMediaSearchActive,
    sortItems,
  }), [sortItems, getItemsForParent, classicExpandedFolderIdSet, isMediaSearchActive]);
  const dynamicMediaColumnWidths = useMemo(
    () => getClassicMediaColumnWidths(classicRows.map((row) => row.item)),
    [classicRows],
  );

  const classicVisibleRange = useMemo(() => getClassicVisibleRange({
    viewportHeight: classicListViewport.height,
    scrollTop: classicListViewport.scrollTop,
    rowCount: classicRows.length,
  }), [classicListViewport.height, classicListViewport.scrollTop, classicRows.length]);

  const classicVisibleRows = useMemo(
    () => classicRows.slice(classicVisibleRange.start, classicVisibleRange.end),
    [classicRows, classicVisibleRange.end, classicVisibleRange.start],
  );

  return {
    allProjectItems,
    allProjectItemsById,
    totalItems,
    isMediaSearchActive,
    mediaSearchVisibleItemIds,
    mediaSearchResultCount,
    getItemsForParent,
    classicRows,
    dynamicMediaColumnWidths,
    classicVisibleRows,
    classicTopSpacerHeight: classicVisibleRange.start * CLASSIC_ROW_HEIGHT,
    classicBottomSpacerHeight: Math.max(0, (classicRows.length - classicVisibleRange.end) * CLASSIC_ROW_HEIGHT),
    gridItems: isMediaSearchActive
      ? sortItems(mediaSearchDirectMatches)
      : sortItems(getItemsForParent(gridFolderId)),
    gridBreadcrumb: buildGridBreadcrumb(isMediaSearchActive, gridFolderId, folders),
  };
}
