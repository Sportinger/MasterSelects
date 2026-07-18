import {
  createSignalAssetItem,
  mergeSignalArtifacts,
} from '../../../stores/mediaStore/helpers/signalItems';
import type { ProjectFile } from '../../projectFileService';
import { normalizeItemFolderParents } from './loadMediaHydration';

export function createGeneratedMediaItemsForLoad(
  projectData: ProjectFile,
  validFolderIds: ReadonlySet<string>,
) {
  return {
    textItems: normalizeItemFolderParents(projectData.textItems || [], validFolderIds, 'text items'),
    solidItems: normalizeItemFolderParents(projectData.solidItems || [], validFolderIds, 'solid items'),
    meshItems: normalizeItemFolderParents(projectData.meshItems || [], validFolderIds, 'mesh items'),
    cameraItems: normalizeItemFolderParents(projectData.cameraItems || [], validFolderIds, 'camera items'),
    lightItems: normalizeItemFolderParents(projectData.lightItems || [], validFolderIds, 'light items'),
    splatEffectorItems: normalizeItemFolderParents(projectData.splatEffectorItems || [], validFolderIds, 'splat effector items'),
    mathSceneItems: normalizeItemFolderParents(projectData.mathSceneItems || [], validFolderIds, 'math scene items'),
    motionShapeItems: normalizeItemFolderParents(projectData.motionShapeItems || [], validFolderIds, 'motion shape items'),
  };
}

export function createSignalHydrationStateForLoad(
  projectData: ProjectFile,
  validFolderIds: ReadonlySet<string>,
) {
  const signalItemMetadata = new Map(
    (projectData.signals?.assetItems ?? []).map((item) => [item.id, item]),
  );
  const signalAssets = normalizeItemFolderParents(
    (projectData.signals?.assets ?? []).map((asset) => {
      const metadata = signalItemMetadata.get(asset.id);
      return createSignalAssetItem(asset, {
        parentId: metadata?.parentId ?? null,
        createdAt: metadata?.createdAt,
        labelColor: metadata?.labelColor,
      });
    }),
    validFolderIds,
    'signal assets',
  );
  const signalArtifacts = signalAssets.reduce(
    (artifacts, item) => mergeSignalArtifacts(artifacts, item.artifacts),
    projectData.signals?.artifacts ?? [],
  );

  return {
    signalAssets,
    signalArtifacts,
    signalGraphs: projectData.signals?.graphs ?? [],
    signalOperators: projectData.signals?.operators ?? [],
  };
}
