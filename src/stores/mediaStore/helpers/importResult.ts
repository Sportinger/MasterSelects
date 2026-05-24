import type { FileImportResult, MediaFile, SignalAssetItem } from '../types';

export function isSignalAssetImportResult(item: FileImportResult): item is SignalAssetItem {
  return item.type === 'signal';
}

export function isMediaFileImportResult(item: FileImportResult): item is MediaFile {
  return item.type !== 'signal';
}

export function requireMediaFileImportResult(
  item: FileImportResult,
  context: string,
): MediaFile {
  if (isSignalAssetImportResult(item)) {
    throw new Error(`${context} requires a timeline media file, but "${item.name}" imported as a SignalAsset.`);
  }

  return item;
}
