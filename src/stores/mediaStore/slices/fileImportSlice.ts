// File import actions - unified import logic

import type { FileImportResult, MediaFile, MediaSliceCreator } from '../types';
import type { MediaFileStemInfo } from '../../../types/audio';
import type { ExternalMediaOrigin } from '../../../types/mediaMetadata';
import { createBatchFileImportActions } from './fileImport/batchImportActions';
import { createGaussianImportActions } from './fileImport/gaussianImportActions';
import { createSingleFileImportActions } from './fileImport/singleFileImportActions';

export interface FileImportActions {
  importFile: (file: File, parentId?: string | null, options?: ImportFileOptions) => Promise<FileImportResult>;
  importFiles: (files: FileList | File[], parentId?: string | null) => Promise<FileImportResult[]>;
  importFilesWithPicker: () => Promise<FileImportResult[]>;
  importFilesWithHandles: (filesWithHandles: Array<{
    file: File;
    handle: FileSystemFileHandle;
    absolutePath?: string;
  }>, parentId?: string | null) => Promise<FileImportResult[]>;
  importGaussianAvatar: (file: File, parentId?: string | null) => Promise<MediaFile>;
  importGaussianSplat: (file: File, parentId?: string | null) => Promise<MediaFile>;
}

export interface ImportFileOptions {
  forceCopyToProject?: boolean;
  projectFileName?: string;
  stemInfo?: MediaFileStemInfo;
  externalOrigin?: ExternalMediaOrigin;
}

export const createFileImportSlice: MediaSliceCreator<FileImportActions> = (set, get) => ({
  ...createSingleFileImportActions(set, get),
  ...createBatchFileImportActions(set, get),
  ...createGaussianImportActions(set, get),
});
