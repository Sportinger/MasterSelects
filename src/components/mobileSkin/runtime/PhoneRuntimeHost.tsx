// Single owner of the editor runtime inside the /m phone skin: engine, playback clock and layer
// sync, background generation jobs, global history and project boot. Phone UI below reads the
// result through usePhoneRuntime() and never calls useEngine/useGlobalHistory itself.

import { useCallback, useMemo, type ReactNode } from 'react';
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

export function PhoneRuntimeHost({ children }: PhoneRuntimeHostProps) {
  // Initializes the shared engine and its render loop. Its canvasRef stays unused on purpose:
  // PhonePreview registers its canvas as a render target instead (see SCOUT section 2).
  useEngine();
  usePhoneRuntimeEnvironment();
  const boot = usePhoneProjectBoot();
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
      <PhoneRuntimeOverlays
        bootPending={boot.bootPending}
        historyNotice={historyNotice}
        onHistoryNoticeDone={clearHistoryNotice}
      />
    </PhoneRuntimeProvider>
  );
}
