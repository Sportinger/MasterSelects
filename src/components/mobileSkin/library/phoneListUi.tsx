// Small shared pieces of the phone Library, Settings and project tools: pointer-focus hygiene for a
// whole list, a status line that keeps the last command's result visible, and the media snapshot hook.
import { useCallback, useState, type PointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PhoneActionResult } from '../contracts';
import { useMediaStore } from '../../../stores/mediaStore';
import type { PhoneLibrarySource } from './phoneLibraryModel';

/** onPointerUpCapture for a container: a tapped button drops its focus, keyboard focus stays styled. */
export function blurTappedControl(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const control = (event.target as HTMLElement).closest<HTMLElement>('button, [role="button"], label');
  if (control && control === document.activeElement) control.blur();
  else requestAnimationFrame(() => control?.blur());
}

export interface PhoneStatus { message: string; tone: 'info' | 'error' }

/** Last result line of a sheet; `report` turns a command result into it. */
export function usePhoneStatus() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const report = useCallback((result: PhoneActionResult) => {
    setStatus(result.ok ? (result.message ? { message: result.message, tone: 'info' } : null) : { message: result.message, tone: 'error' });
    return result;
  }, []);
  return { status, setStatus, report };
}

export function PhoneStatusLine({ status, testId }: { status: PhoneStatus | null; testId: string }) {
  return (
    <p className="phone-lib__status" role="status" aria-live="polite" data-tone={status?.tone ?? 'info'} data-testid={testId}>
      {status?.message ?? ''}
    </p>
  );
}

/** The media-store arrays the library lists, re-rendering only when one of them changes. */
export function usePhoneLibrarySource(): PhoneLibrarySource {
  return useMediaStore(useShallow((state) => ({
    files: state.files,
    compositions: state.compositions,
    folders: state.folders,
    textItems: state.textItems,
    solidItems: state.solidItems,
    meshItems: state.meshItems,
    cameraItems: state.cameraItems,
    lightItems: state.lightItems,
    splatEffectorItems: state.splatEffectorItems,
    mathSceneItems: state.mathSceneItems,
    motionShapeItems: state.motionShapeItems,
    signalAssets: state.signalAssets,
  })));
}
