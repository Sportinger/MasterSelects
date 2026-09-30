// Workspace root tools: one-time folder grant, then project creation by disk path
// without a picker. Project switching is never part of a timeline undo batch.

import type { ToolResult } from '../types';
import {
  WorkspaceAccessError,
  displayWorkspacePath,
  listWorkspaceRoots,
  normalizeWorkspacePath,
  requestWorkspaceRootGrant,
  resolveWorkspaceDirectory,
  type WorkspaceAccessMode,
} from '../../workspaceRoots';

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemHandle>;
};

function errorResult(error: unknown, fallback: string): ToolResult {
  if (error instanceof WorkspaceAccessError) {
    return { success: false, error: error.message, data: { code: error.code } };
  }
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

export async function handleGrantWorkspaceRoot(args: Record<string, unknown>): Promise<ToolResult> {
  const path = typeof args.path === 'string' ? args.path : '';
  const mode: WorkspaceAccessMode = args.mode === 'read' ? 'read' : 'readwrite';
  const timeoutMs = typeof args.timeoutMs === 'number' ? Math.max(5000, Math.min(args.timeoutMs, 600000)) : 300000;
  const verifyEntries = Array.isArray(args.verifyEntries)
    ? args.verifyEntries.filter((name): name is string => typeof name === 'string')
    : undefined;
  try {
    const root = await requestWorkspaceRootGrant(path, { mode, timeoutMs, verifyEntries });
    return { success: true, data: root };
  } catch (error) {
    return errorResult(error, 'Folder grant failed.');
  }
}

export async function handleListWorkspaceRoots(args: Record<string, unknown>): Promise<ToolResult> {
  const mode: WorkspaceAccessMode = args.mode === 'read' ? 'read' : 'readwrite';
  try {
    const data: Record<string, unknown> = { roots: await listWorkspaceRoots(mode) };
    if (args.includeHandleKeys === true) {
      const { projectDB } = await import('../../projectDB');
      data.handleKeys = await projectDB.listHandleKeys();
    }
    return { success: true, data };
  } catch (error) {
    return errorResult(error, 'Could not read workspace roots.');
  }
}

async function containsProjectPackage(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  let folder: FileSystemDirectoryHandle;
  try {
    folder = await parent.getDirectoryHandle(name);
  } catch {
    return false;
  }
  const { isProjectPackageFileName } = await import('../../project/core/projectPackage');
  for await (const entry of (folder as IterableDirectoryHandle).values()) {
    if (entry.kind === 'file' && (isProjectPackageFileName(entry.name) || entry.name === 'project.json')) return true;
  }
  return false;
}

export async function handleSaveProject(): Promise<ToolResult> {
  const [{ projectFileService }, { saveCurrentProject }] = await Promise.all([
    import('../../projectFileService'), import('../../project/projectSave'),
  ]);
  if (!projectFileService.isProjectOpen()) return { success: false, error: 'No project is open.' };
  try {
    const saved = await saveCurrentProject({ source: 'manual', label: 'Save (AI tool)' });
    return saved
      ? { success: true, data: { saved: true, project: projectFileService.getProjectData()?.name ?? null } }
      : { success: false, error: 'Saving failed or was skipped (store sync in progress). Retry shortly.' };
  } catch (error) {
    return errorResult(error, 'Saving the project failed.');
  }
}

let creating = false;

export async function handleCreateLocalProject(args: Record<string, unknown>): Promise<ToolResult> {
  if (creating) return { success: false, error: 'Another project is currently being created.' };
  const directory = typeof args.directory === 'string' ? normalizeWorkspacePath(args.directory) : null;
  const segments = directory?.split('/') ?? [];
  const name = segments.at(-1) ?? '';
  if (!directory || segments.length < 2 || /^[A-Z]:$/.test(name)) {
    return { success: false, error: 'Supply the absolute path of the new project folder, e.g. D:/Shows/My Project.' };
  }
  const parentPath = segments.slice(0, -1).join('/') || '/';
  const discardUnsaved = args.discardUnsavedChanges === true;

  creating = true;
  try {
    const [{ projectFileService }, { useTimelineStore }] = await Promise.all([
      import('../../projectFileService'), import('../../../stores/timeline'),
    ]);
    if (useTimelineStore.getState().isExporting) return { success: false, error: 'Wait for the current export to finish.' };
    if (projectFileService.hasUnsavedChanges() && !discardUnsaved) {
      return {
        success: false,
        error: 'The current project has unsaved changes. Save it first or pass discardUnsavedChanges: true.',
      };
    }

    const parent = await resolveWorkspaceDirectory(parentPath, { create: true, mode: 'readwrite' });
    if (await containsProjectPackage(parent, name)) {
      return { success: false, error: `${directory} already contains a project. Use openLocalProject instead.` };
    }

    if (projectFileService.activeBackend !== 'fsa') projectFileService.activateFsaBackend();
    const { createBlankProjectInFolder } = await import('../../project/projectLifecycle');
    const result = await createBlankProjectInFolder(parent, name);
    if (result !== 'created') {
      return { success: false, error: `Project creation ended with "${result}".`, data: { directory, result } };
    }
    return {
      success: true,
      data: { directory: displayWorkspacePath(directory), name, backend: projectFileService.activeBackend },
    };
  } catch (error) {
    return errorResult(error, 'Creating the project failed.');
  } finally {
    creating = false;
  }
}
