import type { ToolResult } from '../types';
import { validateFilePath } from '../../security/fileAccessBroker';

let opening = false;

/** Explicit dev operation; project changes are never part of a timeline undo batch. */
export async function handleOpenLocalProject(args: Record<string, unknown>): Promise<ToolResult> {
  if (opening) return { success: false, error: 'Another project is currently opening.' };
  const directory = typeof args.directory === 'string' ? args.directory.trim().replace(/\\/g, '/').replace(/\/+$/, '') : '';
  const validation = validateFilePath(directory);
  if (!validation.allowed) return { success: false, error: `Project folder access denied: ${validation.reason}` };
  if (/\.msproj$/i.test(directory)) return { success: false, error: 'Supply the project folder, not the .msproj file.' };
  opening = true;
  try {
    const [{ projectFileService }, { useTimelineStore }] = await Promise.all([
      import('../../projectFileService'), import('../../../stores/timeline'),
    ]);
    if (useTimelineStore.getState().isExporting) return { success: false, error: 'Wait for the current export to finish.' };
    if (projectFileService.hasUnsavedChanges()) return { success: false, error: 'Save the current project before opening another project.' };
    const { NativeHelperClient } = await import('../../nativeHelper');
    if (!NativeHelperClient.isConnected() && !await NativeHelperClient.connect()) {
      return { success: false, error: 'Opening a project by disk path requires the Native Helper. Alternatively open its folder with File > Open Project.' };
    }
    // Connection may take time; reject edits/export started during that wait.
    if (useTimelineStore.getState().isExporting || projectFileService.hasUnsavedChanges()) {
      return { success: false, error: 'The current project changed while connecting. Save it and retry after export finishes.' };
    }
    const previousBackend = projectFileService.activeBackend;
    let loaded = false;
    try {
      loaded = await projectFileService.loadProject(directory);
    } finally {
      if (!loaded && previousBackend === 'fsa') projectFileService.activateFsaBackend();
    }
    if (!loaded) return { success: false, error: 'The project folder could not be loaded. Check the path and helper folder access.' };
    const { loadProjectToStores } = await import('../../project/projectLoad');
    await loadProjectToStores();
    return { success: true, data: { directory, backend: projectFileService.activeBackend } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Opening the project failed.' };
  } finally {
    opening = false;
  }
}
