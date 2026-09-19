import type { ProjectFile } from '../types/project.types';
import { encodeProjectTerrain, isTerrainGeometryEntry } from './packageTerrainGeometry';

const persisted = new WeakMap<FileSystemDirectoryHandle, Set<string>>();
async function geometryDirectory(root: FileSystemDirectoryHandle, mediaFolder: string, create: boolean) {
  let folder = await root.getDirectoryHandle(mediaFolder, { create });
  folder = await folder.getDirectoryHandle('Geometry', { create });
  return folder.getDirectoryHandle('terrain', { create });
}
function fileName(path: string): string {
  if (!isTerrainGeometryEntry(path)) throw new Error('Invalid terrain geometry path');
  return path.slice(path.lastIndexOf('/') + 1);
}
export async function readLinkedTerrain(root: FileSystemDirectoryHandle, mediaFolder: string, path: string) {
  const name = fileName(path);
  const folder = await geometryDirectory(root, mediaFolder, false);
  const file = await (await folder.getFileHandle(name)).getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let known = persisted.get(root);
  if (!known) { known = new Set(); persisted.set(root, known); }
  known.add(`${mediaFolder}/${path}`);
  return bytes;
}
/** Finish every new geometry file before publishing a project that references it. */
export async function persistLinkedTerrain(root: FileSystemDirectoryHandle, mediaFolder: string, project: ProjectFile) {
  const encoded = await encodeProjectTerrain(project);
  if (!encoded.entries.length) return false;
  let known = persisted.get(root);
  if (!known) { known = new Set(); persisted.set(root, known); }
  const pending = encoded.entries.filter(([path]) => !known!.has(`${mediaFolder}/${path}`));
  if (!pending.length) return true;
  const folder = await geometryDirectory(root, mediaFolder, true);
  for (const [path, bytes] of pending) {
    const handle = await folder.getFileHandle(fileName(path), { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(new Uint8Array(bytes).buffer);
      await writable.close();
      known.add(`${mediaFolder}/${path}`);
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }
  return true;
}
