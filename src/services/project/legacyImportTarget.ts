/**
 * Old-format projects convert in place: the repository is added to the old folder without changing
 * its files. Only a folder that an earlier version already converted into a separate project folder
 * needs a decision, because converting it again would start from its pre-conversion state.
 */
export type LegacyImportTargetResolver = (source: FileSystemDirectoryHandle) => Promise<FileSystemDirectoryHandle | null>;

let resolver: LegacyImportTargetResolver | null = null;

export function setLegacyImportTargetResolver(next: LegacyImportTargetResolver): () => void {
  resolver = next;
  return () => { if (resolver === next) resolver = null; };
}

/** Returns the source itself to convert in place, a separately converted project folder, or null to cancel. */
export async function requestLegacyImportTarget(source: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  // Loaded lazily: the source-root registry depends on the project file service.
  const { isSeparatelyConvertedLegacyFolder } = await import('./mediaSourceRoots');
  if (!resolver || !await isSeparatelyConvertedLegacyFolder(source)) return source;
  return resolver(source);
}

/** Folder name used by earlier versions for a separately converted copy. */
export function convertedProjectFolderName(sourceName: string): string {
  return `${sourceName} (converted)`;
}
