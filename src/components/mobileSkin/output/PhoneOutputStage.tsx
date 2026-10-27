// Main area of the phone output editor: the live output of the selected target (the desktop Output
// Manager's own preview, drawn by the engine with every slice and mask applied), Input/Output tabs,
// pinch zoom and two-finger pan, Fit, and Done/Cancel. Opening the editor snapshots the mapping;
// Done saves it, Cancel (or leaving with Back) puts the snapshot back.

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { useSliceStore } from '../../../stores/sliceStore';
import { TargetPreview } from '../../outputManager/TargetPreview';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { addPhoneOutputTarget } from './phoneOutputCommands';
import { pinchView, type ScreenPoint } from './phoneOutputGeometry';
import { captureOutputMapping, loadSavedOutputMapping, restoreOutputMapping, saveOutputMapping } from './phoneOutputSession';
import { usePhoneOutputStore, type PhoneOutputView } from './phoneOutputStore';
import { PHONE_OUTPUT_TEST_IDS as IDS } from './phoneOutputTestIds';
import { PhoneOutputHandles } from './PhoneOutputHandles';
import { usePhoneOutputTargets } from './usePhoneOutputTarget';
import './PhoneOutput.css';

const blurAfterTouch = (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); };

/** Snapshot on open; restore when the editor goes away without Done. */
function useOutputEditSession(): void {
  useEffect(() => {
    loadSavedOutputMapping();
    usePhoneOutputStore.getState().setSession(captureOutputMapping());
    usePhoneOutputStore.getState().resetView();
    return () => {
      const open = usePhoneOutputStore.getState().session;
      if (!open) return;
      usePhoneOutputStore.getState().setSession(null);
      restoreOutputMapping(open);
    };
  }, []);
}

/** Two touch fingers on the stage zoom (spread) and pan (move together). */
function usePinch(stageRef: React.RefObject<HTMLDivElement | null>) {
  const pointers = useRef(new Map<number, ScreenPoint>());
  const start = useRef<{ view: PhoneOutputView; a: ScreenPoint; b: ScreenPoint; ids: [number, number] } | null>(null);

  const local = (event: ReactPointerEvent): ScreenPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const end = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (start.current?.ids.includes(event.pointerId)) start.current = null;
  };
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') return;
      pointers.current.set(event.pointerId, local(event));
      if (pointers.current.size === 2) {
        const [[idA, a], [idB, b]] = [...pointers.current.entries()];
        start.current = { view: usePhoneOutputStore.getState().view, a, b, ids: [idA, idB] };
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, local(event));
      const pinch = start.current;
      if (!pinch) return;
      const a = pointers.current.get(pinch.ids[0]);
      const b = pointers.current.get(pinch.ids[1]);
      if (a && b) usePhoneOutputStore.getState().setView(pinchView(pinch.view, pinch.a, pinch.b, a, b));
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

function Tabs() {
  const tab = useSliceStore((state) => state.activeTab);
  const setTab = useSliceStore((state) => state.setActiveTab);
  return (
    <div className="phone-output__tabs" role="tablist" aria-label="What the handles edit">
      {(['input', 'output'] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className="phone-output__tab"
          data-testid={id === 'input' ? IDS.tabInput : IDS.tabOutput}
          onClick={() => setTab(id)}
          onPointerUp={blurAfterTouch}
        >
          {id === 'input' ? 'Input' : 'Output'}
        </button>
      ))}
    </div>
  );
}

export function PhoneOutputStage() {
  useOutputEditSession();
  const { selected } = usePhoneOutputTargets();
  const view = usePhoneOutputStore((state) => state.view);
  const resetView = usePhoneOutputStore((state) => state.resetView);
  const closeWorkspace = usePhoneUiStore((state) => state.closeWorkspace);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pinch = usePinch(stageRef);

  const done = () => {
    const saved = saveOutputMapping();
    usePhoneOutputStore.getState().setSession(null);
    showToast(saved ? 'Output mapping saved' : 'Output mapping kept for this session; browser storage is not available', saved ? 'info' : 'error');
    closeWorkspace();
  };
  const cancel = () => {
    const open = usePhoneOutputStore.getState().session;
    usePhoneOutputStore.getState().setSession(null);
    if (open) restoreOutputMapping(open);
    closeWorkspace();
  };

  return (
    <div className="phone-output" data-testid={IDS.stage} data-target-id={selected?.id ?? ''}>
      <div className="phone-output__bar">
        <Tabs />
        <span className="phone-output__zoom" data-testid={IDS.zoomLabel} data-zoom={view.zoom.toFixed(3)}>{Math.round(view.zoom * 100)}%</span>
        <button type="button" className="phone-output__chip" data-testid={IDS.fit} onClick={resetView} onPointerUp={blurAfterTouch}>Fit</button>
        <span className="phone-output__spacer" />
        <button type="button" className="phone-output__chip" data-testid={IDS.cancel} onClick={cancel} onPointerUp={blurAfterTouch}>Cancel</button>
        <button type="button" className="phone-output__chip phone-output__chip--primary" data-testid={IDS.done} onClick={done} onPointerUp={blurAfterTouch}>Done</button>
      </div>
      <div
        ref={stageRef}
        className="phone-output__stage"
        onPointerDown={pinch.onPointerDown}
        onPointerMove={pinch.onPointerMove}
        onPointerUp={pinch.onPointerUp}
        onPointerCancel={pinch.onPointerCancel}
      >
        {selected ? (
          <div
            className="phone-output__viewport"
            data-testid={IDS.viewport}
            style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
          >
            <div ref={boxRef} className="phone-output__box" data-testid={IDS.box}>
              <TargetPreview targetId={selected.id} />
              <PhoneOutputHandles targetId={selected.id} boxRef={boxRef} />
            </div>
          </div>
        ) : (
          <div className="phone-output__empty">
            <p>No output yet. An output is a projector or screen the show plays on: add one, then map slices and masks onto it.</p>
            <button type="button" className="phone-output__chip phone-output__chip--primary" data-testid={IDS.emptyAdd} onClick={addPhoneOutputTarget} onPointerUp={blurAfterTouch}>
              + Output
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
