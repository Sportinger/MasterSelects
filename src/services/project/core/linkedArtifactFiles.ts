/** Content-addressed binary artifacts are immutable; small manifests stay in the ZIP. */
export function isLinkedArtifactEntry(path: string): boolean {
  return /^Cache\/artifacts\/sha256\/([a-f0-9]{2})\/\1[a-f0-9]{62}\/artifact\.bin$/.test(path);
}

export function linkedArtifactPath(path: string): string {
  if (!isLinkedArtifactEntry(path)) throw new Error('Invalid linked artifact path');
  return path.replace(/^Cache\//, '.masterselects-cache/');
}

const persisted = new WeakMap<FileSystemDirectoryHandle, Set<string>>();
function knownPaths(root: FileSystemDirectoryHandle): Set<string> {
  let paths = persisted.get(root);
  if (!paths) { paths = new Set(); persisted.set(root, paths); }
  return paths;
}

async function artifactDirectory(root: FileSystemDirectoryHandle, mediaFolder: string, path: string, create: boolean) {
  const parts = linkedArtifactPath(path).split('/');
  let folder = await root.getDirectoryHandle(mediaFolder, { create });
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create });
  return folder;
}

export async function readLinkedArtifact(root: FileSystemDirectoryHandle, mediaFolder: string, path: string) {
  const folder = await artifactDirectory(root, mediaFolder, path, false);
  const file = await (await folder.getFileHandle('artifact.bin')).getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  knownPaths(root).add(`${mediaFolder}/${path}`);
  return bytes;
}

/** All binaries must be durable before the ZIP can reference them. Never remove old files here. */
export async function persistLinkedArtifacts(
  root: FileSystemDirectoryHandle, mediaFolder: string, entries: ReadonlyMap<string, Uint8Array>,
): Promise<Set<string>> {
  const paths = new Set([...entries.keys()].filter(isLinkedArtifactEntry));
  const known = knownPaths(root);
  for (const path of paths) {
    if (known.has(`${mediaFolder}/${path}`)) continue;
    const folder = await artifactDirectory(root, mediaFolder, path, true);
    const writable = await (await folder.getFileHandle('artifact.bin', { create: true })).createWritable();
    try {
      await writable.write(entries.get(path)!.slice().buffer);
      await writable.close();
      known.add(`${mediaFolder}/${path}`);
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }
  return paths;
}
