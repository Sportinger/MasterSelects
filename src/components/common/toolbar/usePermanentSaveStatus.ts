import { useCallback, useEffect, useState } from 'react';
import { Logger } from '../../../services/logger';
import { isBrowserStorageFallbackActive, subscribeBrowserStorageKind } from '../../../services/project/core/browserStorageRoot';
import { getActiveRepositorySession, isScratchRepository, subscribeRepositoryLifecycle } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { canUsePersistentBrowserStorage, listTemporaryProjects } from '../../../services/project/permanentSave/browserStorageMigration';
import { isBrowserLocalProjectLocation, isTemporaryProjectLocation, needsHomeScreenStep, type StoragePersistence } from '../../../services/project/permanentSave/permanentSaveOptions';
import { readStoragePersistence } from '../../../services/project/permanentSave/storagePersistence';
import { resolveAppleHomeScreenMode, type AppleHomeScreenMode } from '../../../utils/mobileAppleWebKit';

const log = Logger.create('PermanentSave');

export interface PermanentSaveStatus {
  /** The open project lives in the temporary IndexedDB fallback. */
  activeTemporary: boolean;
  /** The open temporary project is the unnamed browser recovery, not a named project. */
  scratch: boolean;
  /** OPFS works in this tab now, so temporary projects can move into it. */
  persistentBrowserStorage: boolean;
  /** This tab opens browser projects from OPFS, so projects moved there show up in Open Project. */
  tabOnPersistentStorage: boolean;
  /** Other projects still held in the fallback database. */
  temporaryProjects: string[];
  /** The open project lives in this browser's persistent storage (OPFS). */
  activeBrowserLocal: boolean;
  /** iPhone/iPad browser tab or Home Screen app; `none` elsewhere. */
  homeScreen: AppleHomeScreenMode;
  /** Whether the browser promised to keep this origin's storage; checked only where it decides the toolbar hint. */
  persistence: StoragePersistence;
  refresh(): void;
}

function readActive() {
  const session = getActiveRepositorySession();
  const activeTemporary = isTemporaryProjectLocation(session?.location);
  return {
    activeTemporary, scratch: activeTemporary && isScratchRepository(), tabOnPersistentStorage: !isBrowserStorageFallbackActive(),
    activeBrowserLocal: isBrowserLocalProjectLocation(session?.location),
  };
}

/** Follows the open project's storage and looks for projects left in the temporary store. */
export function usePermanentSaveStatus(): PermanentSaveStatus {
  const [active, setActive] = useState(readActive);
  // Fixed for the page: a tab never turns into a Home Screen app.
  const [homeScreen] = useState(() => resolveAppleHomeScreenMode());
  const [probe, setProbe] = useState({ persistentBrowserStorage: false, temporaryProjects: [] as string[], persistence: null as StoragePersistence });
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);

  useEffect(() => {
    const update = () => {
      setActive(previous => {
        const next = readActive();
        return previous.activeTemporary === next.activeTemporary && previous.scratch === next.scratch
          && previous.tabOnPersistentStorage === next.tabOnPersistentStorage
          && previous.activeBrowserLocal === next.activeBrowserLocal ? previous : next;
      });
      setGeneration(value => value + 1);
    };
    const stopLifecycle = subscribeRepositoryLifecycle(update);
    const stopKind = subscribeBrowserStorageKind(update);
    update();
    return () => { stopLifecycle(); stopKind(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const temporaryProjects = await listTemporaryProjects();
          // Probing OPFS writes a tiny file; only worth it when something is temporary.
          const persistentBrowserStorage = (active.activeTemporary || temporaryProjects.length > 0)
            && await canUsePersistentBrowserStorage();
          // Only an iPhone/iPad tab shows a hint that depends on persistence.
          const persistence = needsHomeScreenStep({ ...active, homeScreen }) ? await readStoragePersistence() : null;
          if (!cancelled) setProbe({ persistentBrowserStorage, temporaryProjects, persistence });
        } catch (error) {
          log.warn('Could not check for projects in temporary storage', error);
          if (!cancelled) setProbe({ persistentBrowserStorage: false, temporaryProjects: [], persistence: null });
        }
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, homeScreen, generation]);

  return { ...active, ...probe, homeScreen, refresh };
}
