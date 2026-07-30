import type { ExportMode } from './types';

/**
 * Export decode mode is a user choice. Content type may affect the renderer,
 * but must never silently upgrade a fast export to HTMLVideo precise seeking.
 */
export function resolveRequestedExportMode(exportMode: ExportMode | undefined): ExportMode {
  return exportMode === 'precise' ? 'precise' : 'fast';
}
