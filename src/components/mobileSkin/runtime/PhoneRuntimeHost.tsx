// Single owner of the editor runtime inside the /m phone skin: engine, playback clock and layer
// sync, background generation jobs, global history and project boot. Phone UI below reads the
// result through usePhoneRuntime() and never calls useEngine/useGlobalHistory itself.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { EditorPlaybackRuntimeHost } from '../../common/EditorPlaybackRuntimeHost';
import { FlashBoardRuntimeHost } from '../../panels/flashboard/FlashBoardRuntimeHost';
import { useEngine } from '../../../hooks/useEngine';
import { useGlobalHistory } from '../../../hooks/useGlobalHistory';
import { Logger } from '../../../services/logger';
import { useEngineStore } from '../../../stores/engineStore';
import type { PhoneHistoryControls, PhoneRuntimeValue } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneRuntimeProvider } from './PhoneRuntimeContext';
import { PhoneRuntimeOverlays } from './PhoneRuntimeOverlays';
import { markPhoneBootPhase } from './phoneBootTimeline';
import { readPhoneEngineStartDeferral } from './phoneEngineStartPolicy';
import { usePhoneBootTimings } from './usePhoneBootTimings';
import { usePhoneProjectBoot } from './usePhoneProjectBoot';
import { usePhoneRuntimeEnvironment } from './usePhoneRuntimeEnvironment';

const log = Logger.create('PhoneRuntime');

function runHistoryOperation(operation: 'undo' | 'redo', action: () => unknown): void {
  try {
    void Promise.resolve(action()).catch((error: unknown) => {
      log.error(`Phone ${operation} failed`, error);
      usePhoneUiStore.getState().showToast(`${operation === 'undo' ? 'Undo' : 'Redo'} failed.`, 'error');
    });
  } catch (error) {
    log.error(`Phone ${operation} failed`, error);
    usePhoneUiStore.getState().showToast(`${operation === 'undo' ? 'Undo' : 'Redo'} failed.`, 'error');
  }
}

interface PhoneRuntimeHostProps {
  children: ReactNode;
}

/**
 * Initializes the shared engine and its render loop. Its canvasRef stays unused on purpose:
 * PhonePreview registers its canvas as a render target instead (see SCOUT section 2).
 * Mounted once and never unmounted, so the engine starts exactly once.
 */
function PhoneEngineStarter() {
  useEngine();
  return null;
}

export function PhoneRuntimeHost({ children }: PhoneRuntimeHostProps) {
  markPhoneBootPhase('boot-start');
  usePhoneRuntimeEnvironment();
  const boot = usePhoneProjectBoot();
  usePhoneBootTimings(boot.bootPending, boot.projectOpen);
  // Read once per page: a device whose adapter request stalled before starts the GPU after the project.
  const [deferEngine] = useState(() => {
    const defer = readPhoneEngineStartDeferral();
    if (defer) log.warn('GPU start deferred until the project is open (adapter request stalled on an earlier start)');
    return defer;
  });
  const engineStartAllowed = !deferEngine || !boot.bootPending;
  const { undo, redo, canUndo, canRedo, historyNotice, clearHistoryNotice } = useGlobalHistory();

  const engineReady = useEngineStore((s) => s.isEngineReady);
  const engineInitFailed = useEngineStore((s) => s.engineInitFailed);
  const engineInitError = useEngineStore((s) => s.engineInitError);

  const phoneUndo = useCallback(() => runHistoryOperation('undo', undo), [undo]);
  const phoneRedo = useCallback(() => runHistoryOperation('redo', redo), [redo]);

  const history = useMemo<PhoneHistoryControls>(() => ({
    undo: phoneUndo,
    redo: phoneRedo,
    canUndo,
    canRedo,
  }), [phoneUndo, phoneRedo, canUndo, canRedo]);

  const value = useMemo<PhoneRuntimeValue>(() => ({
    status: {
      bootPending: boot.bootPending,
      projectOpen: boot.projectOpen,
      permissionPending: boot.permissionPending,
      bootError: boot.bootError,
      engineReady,
      engineError: engineInitFailed
        ? engineInitError || 'The preview renderer could not be initialized.'
        : null,
    },
    history,
  }), [
    boot.bootPending,
    boot.projectOpen,
    boot.permissionPending,
    boot.bootError,
    engineReady,
    engineInitFailed,
    engineInitError,
    history,
  ]);

  const projectSelection = useMemo(
    () => ({ markProjectSelected: boot.markProjectSelected }),
    [boot.markProjectSelected],
  );

  return (
    <PhoneRuntimeProvider value={value} projectSelection={projectSelection}>
      <FlashBoardRuntimeHost />
      <EditorPlaybackRuntimeHost />
      {children}
      {engineStartAllowed && <PhoneEngineStarter />}
      <PhoneRuntimeOverlays
        bootPending={boot.bootPending}
        historyNotice={historyNotice}
        onHistoryNoticeDone={clearHistoryNotice}
      />
    </PhoneRuntimeProvider>
  );
}
