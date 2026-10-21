import { useCallback, useEffect, useState } from 'react';
import { Logger } from '../../../services/logger';
import { subscribeBrowserStorageKind } from '../../../services/project/core/browserStorageRoot';
import { getActiveRepositorySession, isScratchRepository, subscribeRepositoryLifecycle } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { canUsePersistentBrowserStorage, listTemporaryProjects } from '../../../services/project/permanentSave/browserStorageMigration';
import { isTemporaryProjectLocation } from '../../../services/project/permanentSave/permanentSaveOptions';

const log = Logger.create('PermanentSave');

export interface PermanentSaveStatus {
  /** The open project lives in the temporary IndexedDB fallback. */
  activeTemporary: boolean;
  /** The open temporary project is the unnamed browser recovery, not a named project. */
  scratch: boolean;
  /** OPFS works in this tab now, so temporary projects can move into it. */
  persistentBrowserStorage: boolean;
  /** Other projects still held in the fallback database. */
  temporaryProjects: string[];
  refresh(): void;
}

function readActive() {
  const session = getActiveRepositorySession();
  const activeTemporary = isTemporaryProjectLocation(session?.location);
  return { activeTemporary, scratch: activeTemporary && isScratchRepository() };
}

/** Follows the open project's storage and looks for projects left in the temporary store. */
export function usePermanentSaveStatus(): PermanentSaveStatus {
  const [active, setActive] = useState(readActive);
  const [probe, setProbe] = useState({ persistentBrowserStorage: false, temporaryProjects: [] as string[] });
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);

  useEffect(() => {
    const update = () => {
      setActive(previous => {
        const next = readActive();
        return previous.activeTemporary === next.activeTemporary && previous.scratch === next.scratch ? previous : next;
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
          if (!cancelled) setProbe({ persistentBrowserStorage, temporaryProjects });
        } catch (error) {
          log.warn('Could not check for projects in temporary storage', error);
          if (!cancelled) setProbe({ persistentBrowserStorage: false, temporaryProjects: [] });
        }
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active.activeTemporary, generation]);

  return { ...active, ...probe, refresh };
}
