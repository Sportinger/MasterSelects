import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiPreviewPanel } from '../../src/components/preview/MultiPreviewPanel';
import { resolvePreviewHostInitialEdit } from '../../src/components/preview/usePreviewHostInitialEdit';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { MultiPreviewPanelData } from '../../src/types/dock';

const DEFAULT_MULTI_PREVIEW_DATA: MultiPreviewPanelData = {
  sourceCompositionId: null,
  slots: [{ compositionId: null }, { compositionId: null }, { compositionId: null }, { compositionId: null }],
  showTransparencyGrid: false,
};

// tests/setup.ts replaces the media store with a stub; give the panel a selector-aware one.
let mediaState: Record<string, unknown> = { compositions: [], activeCompositionId: null, files: [] };
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mediaState = { compositions: [], activeCompositionId: null, files: [] };
  vi.mocked(useMediaStore).mockImplementation(((selector?: (state: Record<string, unknown>) => unknown) => (
    selector ? selector(mediaState) : mediaState
  )) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Multi Preview outside the dock (phone Multicam editor)', () => {
  it('keeps layout changes when the panel id is not a dock panel', () => {
    render(<MultiPreviewPanel panelId="phone-panel-multi-preview" data={DEFAULT_MULTI_PREVIEW_DATA} />);
    const toggle = screen.getByTitle('Toggle transparency grid (checkerboard)');
    expect(toggle.className).not.toContain('active');
    fireEvent.click(toggle);
    expect(screen.getByTitle('Toggle transparency grid (checkerboard)').className).toContain('active');
  });

  it('says why Multicam could not start instead of failing silently', () => {
    const setMulticamActive = vi.fn(() => false);
    useTimelineStore.setState({ setMulticamActive });
    mediaState = { ...mediaState, activeCompositionId: 'phone-test-comp' };
    render(<MultiPreviewPanel panelId="phone-panel-multi-preview" data={DEFAULT_MULTI_PREVIEW_DATA} />);
    const button = screen.getByRole('button', { name: 'Multicam' });
    fireEvent.click(button);
    expect(setMulticamActive).toHaveBeenCalledWith(true);
    expect(screen.getByRole('status').textContent).toMatch(/two video tracks/i);
  });
});

describe('Preview host initial edit', () => {
  it('opens the phone 3D scene editor preview as a 3D edit view', () => {
    document.body.innerHTML = '<div class="phone-workspace" data-workspace="scene3d"><main class="phone-workspace__main"><div id="p"></div></main></div>';
    expect(resolvePreviewHostInitialEdit(document.getElementById('p'))).toEqual({ initialEditMode: true, initialEditCameraView: 'camera' });
  });

  it('honours an explicit host view and ignores other phone editors and the dock', () => {
    document.body.innerHTML = [
      '<div data-preview-initial-edit-view="top"><div id="top"></div></div>',
      '<div class="phone-workspace" data-workspace="nodes"><aside><div id="side"></div></aside></div>',
      '<div class="phone-workspace" data-workspace="scene3d"><aside class="phone-workspace__side"><div id="scene-side"></div></aside></div>',
      '<div id="dock"></div>',
    ].join('');
    expect(resolvePreviewHostInitialEdit(document.getElementById('top'))).toEqual({ initialEditMode: true, initialEditCameraView: 'top' });
    expect(resolvePreviewHostInitialEdit(document.getElementById('side'))).toBeUndefined();
    expect(resolvePreviewHostInitialEdit(document.getElementById('scene-side'))).toBeUndefined();
    expect(resolvePreviewHostInitialEdit(document.getElementById('dock'))).toBeUndefined();
  });
});

describe('Touch mouse bridge compatibility click', () => {
  it('swallows only the touched element\'s compatibility click, not a new tap elsewhere', async () => {
    const { useTouchMouseBridge } = await import('../../src/components/preview/useTouchMouseBridge');
    const onGizmoClick = vi.fn();
    const onToolbarClick = vi.fn();
    function Harness() {
      const bridge = useTouchMouseBridge<HTMLDivElement>({ emitClick: false });
      return (
        <div
          onClickCapture={bridge.onClickCapture}
          onPointerDownCapture={bridge.onPointerDown}
          onPointerUpCapture={bridge.onPointerUp}
        >
          <button data-testid="gizmo" onClick={onGizmoClick} type="button" />
          <button data-testid="toolbar" onClick={onToolbarClick} type="button" />
        </div>
      );
    }
    render(<Harness />);
    const touch = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 10 }) as PointerEvent;
      Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 4 }, pointerType: { value: 'touch' } });
      return event;
    };
    fireEvent(screen.getByTestId('gizmo'), touch('pointerdown', 10));
    fireEvent(screen.getByTestId('gizmo'), touch('pointerup', 10));
    fireEvent.click(screen.getByTestId('gizmo'), { clientX: 10, clientY: 10 });
    expect(onGizmoClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('toolbar'), { clientX: 200, clientY: 10 });
    expect(onToolbarClick).toHaveBeenCalledOnce();
  });
});
