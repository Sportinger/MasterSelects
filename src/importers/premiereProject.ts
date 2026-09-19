import type { MediaFile } from '../stores/mediaStore/types';
import { parsePremiereProjectFile, parsePremiereProjectXmlText } from './premiere/premiereProjectFileParser';
import { importPremiereProjectInWorker } from './premiere/premiereProjectWorkerClient';
import type {
  PremiereExistingMediaDescriptor,
  PremiereProjectImportOptions,
  PremiereProjectImportResult,
} from './premiere/premiereProjectTypes';

export type {
  PremiereProjectImportOptions,
  PremiereProjectImportProgress,
  PremiereProjectImportResult,
  PremiereProjectSequenceSummary,
  PremiereProjectSummary,
} from './premiere/premiereProjectTypes';

export function isPremiereProjectFile(file: Pick<File, 'name'>): boolean {
  return file.name.toLowerCase().endsWith('.prproj');
}

export async function importPremiereProject(
  file: File,
  existingMedia: readonly MediaFile[],
  parentId: string | null = null,
  options: PremiereProjectImportOptions = {},
): Promise<PremiereProjectImportResult> {
  const descriptors = existingMedia.map(describeExistingMedia);
  if (typeof Worker !== 'undefined') {
    return importPremiereProjectInWorker(file, descriptors, parentId, options);
  }
  return parsePremiereProjectFile(file, descriptors, parentId, options);
}

export function parsePremiereProjectXml(
  xmlText: string,
  fileName: string,
  existingMedia: readonly MediaFile[],
  parentId: string | null = null,
): PremiereProjectImportResult {
  return parsePremiereProjectXmlText(
    xmlText,
    fileName,
    existingMedia.map(describeExistingMedia),
    parentId,
  );
}

function describeExistingMedia(media: MediaFile): PremiereExistingMediaDescriptor {
  return {
    id: media.id,
    name: media.name,
    type: media.type,
    duration: media.duration,
    fileName: media.file?.name,
    filePath: media.filePath,
    absolutePath: media.absolutePath,
    projectPath: media.projectPath,
    linkedSources: media.linkedSources?.map((source) => ({ ...source })),
    sourceSelection: media.sourceSelection ? { ...media.sourceSelection } : undefined,
  };
}
