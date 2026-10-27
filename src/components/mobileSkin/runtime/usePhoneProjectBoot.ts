// Project boot for the /m phone skin: the same restore orchestration the desktop Toolbar runs
// (Android mirror, last project, store activation), without mounting the desktop Toolbar.

import { useCallback, useEffect, useRef, useState } from 'react';
import { runToolbarProjectBootRestore } from '../../common/toolbar/toolbarProjectStartup';
import { restoreAndroidProjectAutomatically } from '../../../services/project/androidProjectAutoRestore';
import {
  BROWSER_STORAGE_UNAVAILABLE_MESSAGE,
  describeBrowserStorageFailure,
} from '../../../services/project/core/browserStorageFailure';
import { teardownAutoSync } from '../../../services/project/projectLifecycle';
import { projectDB } from '../../../services/projectDB';
import { projectFileService } from '../../../services/projectFileService';
import {
  loadProjectToStores,
  setProjectLoadProgress,
  setupAutoSync,
} from '../../../services/projectSync';
import { Logger } from '../../../services/logger';
import { markPhoneBootPhase } from './phoneBootTimeline';
import { subscribePhoneProjectStateChanges } from './phoneProjectStateEvents';

const log = Logger.create('PhoneProjectBoot');

/** Project state changes rarely; the desktop App polls at the same rate. */
const PROJECT_STATE_POLL_MS = 2000;

const RESTORE_FAILED_MESSAGE = 'The last project could not be restored. Open it again from the project list.';

export interface PhoneProjectBootState {
  bootPending: boolean;
  projectOpen: boolean;
  permissionPending: boolean;
  /** Actionable message for a storage or restore problem, null when everything is fine. */
  bootError: string | null;
  /** Called by the project chooser once it has opened or created a project. */
  markProjectSelected: () => void;
}

export function usePhoneProjectBoot(): PhoneProjectBootState {
  const [bootPending, setBootPending] = useState(true);
  const [projectOpen, setProjectOpen] = useState(() => projectFileService.isProjectOpen());
  const [permissionPending, setPermissionPending] = useState(() => projectFileService.needsPermission());
  const [bootError, setBootError] = useState<string | null>(null);
  const bootStartedRef = useRef(false);
  const bootDoneRef = useRef(false);
  const aliveRef = useRef(false);

  const refreshProjectState = useCallback(() => {
    setProjectOpen(projectFileService.isProjectOpen());
    setPermissionPending(projectFileService.needsPermission());
  }, []);

  // Opening or closing a project from the phone refreshes at once instead of waiting for the poll.
  useEffect(() => subscribePhoneProjectStateChanges(refreshProjectState), [refreshProjectState]);

  const markProjectSelected = useCallback(() => {
    refreshProjectState();
    setProjectOpen(true);
    setBootError(null);
  }, [refreshProjectState]);

  // IndexedDB health (App.tsx parity): a storage failure is not "no recent project".
  useEffect(() => {
    let cancelled = false;
    const reportStorageFailure = () => {
      if (cancelled) return;
      log.warn('Browser storage is unavailable for the phone skin');
      setBootError(BROWSER_STORAGE_UNAVAILABLE_MESSAGE);
    };
    const check = async () => {
      if (projectDB.hasInitFailed()) {
        reportStorageFailure();
        return;
      }
      try {
        await projectDB.hasLastProject();
      } catch {
        if (projectDB.hasInitFailed()) reportStorageFailure();
      }
      if (!cancelled) refreshProjectState();
    };
    void check();
    const interval = window.setInterval(() => void check(), PROJECT_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshProjectState]);

  // One boot owner. Fast Refresh re-runs this effect: it re-arms auto-sync instead of booting twice.
  useEffect(() => {
    aliveRef.current = true;
    if (bootStartedRef.current) {
      if (bootDoneRef.current) setupAutoSync();
      return () => {
        aliveRef.current = false;
        teardownAutoSync();
      };
    }
    bootStartedRef.current = true;

    const finishBoot = () => {
      bootDoneRef.current = true;
      if (!aliveRef.current) return;
      setupAutoSync();
      refreshProjectState();
      setBootPending(false);
    };

    // Nothing in this restore waits for the GPU: the engine starts in parallel (PhoneRuntimeHost)
    // and the preview shows its own "starting" state until it is ready.
    const restore = async () => {
      markPhoneBootPhase('boot-start');
      setProjectLoadProgress({
        phase: 'opening',
        percent: 3,
        message: 'Restoring last project',
        blocking: true,
      });
      const result = await runToolbarProjectBootRestore({
        url: window.location.href,
        restoreLastProject: async () => {
          const opened = await restoreAndroidProjectAutomatically((handle) => projectFileService.loadProject(handle))
            || await projectFileService.restoreLastProject();
          markPhoneBootPhase('repository-open', opened ? 'restored' : 'no last project');
          return opened;
        },
        loadProjectToStores,
      });
      markPhoneBootPhase('stores-hydrated', result);
      log.info('Phone project boot resolved', { result });
      // A restored project completes its own progress inside loadProjectToStores.
      if (result !== 'restored') setProjectLoadProgress(null);
      finishBoot();
    };

    void restore().catch((error: unknown) => {
      log.error('Failed to resolve phone project boot state', error);
      setProjectLoadProgress(null);
      if (aliveRef.current) setBootError(describeBrowserStorageFailure(error) ?? RESTORE_FAILED_MESSAGE);
      finishBoot();
    });

    return () => {
      aliveRef.current = false;
      teardownAutoSync();
    };
  }, [refreshProjectState]);

  return { bootPending, projectOpen, permissionPending, bootError, markProjectSelected };
}
