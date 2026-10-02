/**
 * Converting an old-format project needs a destination folder. Directory pickers require a fresh
 * user gesture, so the toolbar supplies a dialog that asks for it; the project service only awaits it.
 */
export type LegacyImportTargetResolver = (source: FileSystemDirectoryHandle) => Promise<FileSystemDirectoryHandle | null>;

let resolver: LegacyImportTargetResolver | null = null;

export function setLegacyImportTargetResolver(next: LegacyImportTargetResolver): () => void {
  resolver = next;
  return () => { if (resolver === next) resolver = null; };
}

export async function requestLegacyImportTarget(source: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  if (!resolver) throw new Error('Old-format projects can only be converted from the editor window');
  return resolver(source);
}

/** Folder name for the converted copy, placed in the folder the user chose. */
export function convertedProjectFolderName(sourceName: string): string {
  return `${sourceName} (converted)`;
}
