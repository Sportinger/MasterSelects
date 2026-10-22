// Which "Save permanently" destinations this device can actually use, best first.
// Pure decisions only; probing the browser happens in permanentSaveEnvironment.

import type { AppleHomeScreenMode } from '../../../utils/mobileAppleWebKit';
import { resolveBrowserStore } from '../core/browserStorageRoot';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';

/**
 * home-screen: iPhone/iPad browser tab only: add MasterSelects to the Home Screen,
 *          whose storage Safari does not evict, and take the project along as .msproj.
 * folder:  a project folder on disk (folder picker or Native Helper); the project moves there.
 * browser: this browser's persistent project storage (OPFS); the project moves there.
 * archive: a downloaded .msproj archive; the open project itself stays where it is.
 */
export type PermanentSaveDestination = 'home-screen' | 'folder' | 'browser' | 'archive';

export interface PermanentSaveEnvironment {
  /** The open project lives in the temporary IndexedDB fallback. */
  activeTemporary: boolean;
  folderPicker: boolean;
  nativeHelper: boolean;
  /** OPFS opens and accepts writes in this tab now. */
  persistentBrowserStorage: boolean;
  /** The open project lives in this browser's persistent storage (OPFS). */
  activeBrowserLocal?: boolean;
  /** iPhone/iPad tab or Home Screen app; `none` (default) elsewhere. */
  homeScreen?: AppleHomeScreenMode;
}

export function isTemporaryProjectLocation(location: RepositoryLocation | null | undefined): boolean {
  return location?.kind === 'opfs' && resolveBrowserStore(location.store) === 'indexeddb';
}

/** Browser-local (OPFS) projects, which Safari tabs still evict after seven days without a visit. */
export function isBrowserLocalProjectLocation(location: RepositoryLocation | null | undefined): boolean {
  return location?.kind === 'opfs' && !isTemporaryProjectLocation(location);
}

/** An iPhone/iPad browser tab holds the open project in storage Safari may evict. */
export function needsHomeScreenStep(state: { activeTemporary: boolean; activeBrowserLocal?: boolean; homeScreen?: AppleHomeScreenMode }): boolean {
  return state.homeScreen === 'browser-tab' && (state.activeTemporary || state.activeBrowserLocal === true);
}

export function resolvePermanentSaveDestinations(environment: PermanentSaveEnvironment): PermanentSaveDestination[] {
  const homeScreenStep = needsHomeScreenStep(environment);
  if (!environment.activeTemporary && !homeScreenStep) return [];
  const destinations: PermanentSaveDestination[] = homeScreenStep ? ['home-screen'] : [];
  if (environment.activeTemporary && (environment.folderPicker || environment.nativeHelper)) destinations.push('folder');
  if (environment.activeTemporary && environment.persistentBrowserStorage) destinations.push('browser');
  // For a browser-local project the archive is the backup outside Safari's storage.
  destinations.push('archive');
  return destinations;
}

export interface TemporaryProjectsState {
  activeTemporary: boolean;
  persistentBrowserStorage: boolean;
  /** This tab opens browser projects from OPFS (or has not chosen yet), not from the fallback. */
  tabOnPersistentStorage: boolean;
  temporaryProjects: readonly string[];
}

/**
 * Projects left in the fallback can move into OPFS only while this tab itself
 * uses OPFS: otherwise Open Project and their recent entries still resolve to the
 * fallback, and the moved projects could not be opened here.
 */
export function canMoveTemporaryProjects(state: TemporaryProjectsState): boolean {
  return state.persistentBrowserStorage && state.tabOnPersistentStorage && state.temporaryProjects.length > 0;
}

/** null while unknown; `unsupported` when the browser has no persistence API. */
export type StoragePersistence = boolean | 'unsupported' | null;

export interface PermanentSaveHintState extends TemporaryProjectsState {
  activeBrowserLocal?: boolean;
  homeScreen?: AppleHomeScreenMode;
  /** `navigator.storage.persisted()` for this origin. */
  persistence?: StoragePersistence;
}

/**
 * temporary: the open project is in the temporary fallback.
 * not-safe:  iPhone/iPad tab, the project is browser-local and the browser did not
 *            promise to keep it (unknown while still checking, so no flicker).
 * move:      projects left in the fallback can move into permanent storage.
 */
export type PermanentSaveHint = 'temporary' | 'not-safe' | 'move';

export function resolvePermanentSaveHint(state: PermanentSaveHintState): PermanentSaveHint | null {
  if (state.activeTemporary) return 'temporary';
  if (needsHomeScreenStep(state) && state.persistence !== true && state.persistence != null) return 'not-safe';
  return canMoveTemporaryProjects(state) ? 'move' : null;
}

/** The toolbar action shows while the open project is at risk, or while other projects can be moved out. */
export function shouldOfferPermanentSave(state: PermanentSaveHintState): boolean {
  return resolvePermanentSaveHint(state) !== null;
}
