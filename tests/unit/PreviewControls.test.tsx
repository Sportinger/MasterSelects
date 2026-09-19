import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewControls } from '../../src/components/preview/PreviewControls';

describe('PreviewControls', () => {
  const renderControls = (
    sceneObjectOverlayEnabled = true,
    setSceneObjectOverlayEnabled = vi.fn(),
  ) => render(
    <PreviewControls
      sourceMonitorActive={false}
      sourceMonitorFileName={null}
      closeSourceMonitor={vi.fn()}
      editMode={false}
      canEdit
      setEditMode={vi.fn()}
      showEditViewControls={false}
      sceneObjectOverlayEnabled={sceneObjectOverlayEnabled}
      setSceneObjectOverlayEnabled={setSceneObjectOverlayEnabled}
      viewZoom={1}
      resetView={vi.fn()}
      source={{ type: 'activeComp' }}
      sourceLabel="Active"
      activeCompositionId={null}
      activeCompositionVideoTracks={[]}
      selectorOpen={false}
      setSelectorOpen={vi.fn()}
      setSceneGizmoToolbarTarget={vi.fn()}
      dropdownRef={createRef<HTMLDivElement>()}
      dropdownStyle={{}}
      compositions={[]}
      setPanelSource={vi.fn()}
    />,
  );

  it('orders overlay, Edit, source, and 3D tools from left to right', () => {
    const { container } = renderControls();

    const controls = container.querySelector('.preview-controls');
    expect(controls).not.toBeNull();
    expect(Array.from(controls!.children).map((element) => element.classList.item(0))).toEqual([
      'preview-scene-toggle-btn',
      'preview-edit-btn',
      'preview-comp-dropdown-wrapper',
      'preview-scene-gizmo-toolbar-slot',
    ]);
  });

  it('turns the shared scene overlay off from the icon toggle', () => {
    const setSceneObjectOverlayEnabled = vi.fn();
    renderControls(true, setSceneObjectOverlayEnabled);

    fireEvent.click(screen.getByRole('button', { name: 'Hide scene handles' }));
    expect(setSceneObjectOverlayEnabled).toHaveBeenCalledWith(false);
  });

  it('leaves only the icon toggle visible when overlays are hidden', () => {
    const { container } = renderControls(false);
    const controls = container.querySelector('.preview-controls');

    expect(Array.from(controls!.children).map((element) => element.classList.item(0))).toEqual([
      'preview-scene-toggle-btn',
    ]);
  });
});
