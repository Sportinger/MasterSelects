// Destructive store-sync guard — detects stale media-store state that would
// wipe a populated project file during syncStoresToProject.

import type { MediaFile, useMediaStore } from '../../stores/mediaStore';
import type { ProjectFile, ProjectMediaFile } from '../projectFileService';

export type MediaStoreSnapshot = ReturnType<typeof useMediaStore.getState>;

function countParentedProjectMedia(media: ProjectMediaFile[]): number {
  return media.reduce((count, file) => count + (file.folderId ? 1 : 0), 0);
}

function countParentedStoreMedia(files: MediaFile[]): number {
  return files.reduce((count, file) => count + (file.parentId ? 1 : 0), 0);
}

function looksLikeDefaultStoreComposition(state: MediaStoreSnapshot): boolean {
  if (state.compositions.length !== 1) return false;
  const [composition] = state.compositions;
  return composition?.id === 'comp-1' && composition.name === 'Comp 1';
}

export function shouldBlockDestructiveStoreSync(projectData: ProjectFile, state: MediaStoreSnapshot): boolean {
  const projectMediaCount = projectData.media.length;
  if (projectMediaCount < 50 || state.files.length !== projectMediaCount) return false;

  const projectParentedMedia = countParentedProjectMedia(projectData.media);
  const storeParentedMedia = countParentedStoreMedia(state.files);
  const lostMediaParents = projectParentedMedia >= 20 && storeParentedMedia <= Math.max(1, Math.floor(projectParentedMedia * 0.05));
  const lostMostFolders = projectData.folders.length >= 5 && state.folders.length <= Math.max(1, Math.floor(projectData.folders.length * 0.1));
  const collapsedCompositions = projectData.compositions.length > 1 && looksLikeDefaultStoreComposition(state);

  return lostMediaParents && lostMostFolders && collapsedCompositions;
}
