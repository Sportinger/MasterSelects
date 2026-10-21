// Which "Save permanently" destinations this device can actually use, best first.
// Pure decisions only; probing the browser happens in permanentSaveEnvironment.

import { resolveBrowserStore } from '../core/browserStorageRoot';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';

/**
 * folder:  a project folder on disk (folder picker or Native Helper); the project moves there.
 * browser: this browser's persistent project storage (OPFS); the project moves there.
 * archive: a downloaded .msproj archive; the open project itself stays where it is.
 */
export type PermanentSaveDestination = 'folder' | 'browser' | 'archive';

export interface PermanentSaveEnvironment {
  /** The open project lives in the temporary IndexedDB fallback. */
  activeTemporary: boolean;
  folderPicker: boolean;
  nativeHelper: boolean;
  /** OPFS opens and accepts writes in this tab now. */
  persistentBrowserStorage: boolean;
}

export function isTemporaryProjectLocation(location: RepositoryLocation | null | undefined): boolean {
  return location?.kind === 'opfs' && resolveBrowserStore(location.store) === 'indexeddb';
}

export function resolvePermanentSaveDestinations(environment: PermanentSaveEnvironment): PermanentSaveDestination[] {
  if (!environment.activeTemporary) return [];
  const destinations: PermanentSaveDestination[] = [];
  if (environment.folderPicker || environment.nativeHelper) destinations.push('folder');
  if (environment.persistentBrowserStorage) destinations.push('browser');
  destinations.push('archive');
  return destinations;
}

/** The toolbar action shows while the open project is temporary, or while other projects can be moved out. */
export function shouldOfferPermanentSave(state: {
  activeTemporary: boolean;
  persistentBrowserStorage: boolean;
  temporaryProjects: readonly string[];
}): boolean {
  return state.activeTemporary || (state.persistentBrowserStorage && state.temporaryProjects.length > 0);
}
