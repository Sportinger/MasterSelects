import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewControls } from '../../src/components/preview/PreviewControls';
import type { Composition } from '../../src/stores/mediaStore';
import { createMockTrack } from '../helpers/mockData';

function mountSelector() {
  const compositions = ['A', 'B'].map(id => ({
    id, name: `Comp ${id}`, type: 'composition',
    timelineData: { tracks: [createMockTrack({ id: `track-${id}`, name: `${id} Track`, type: 'video' })], clips: [] },
  } as unknown as Composition));
  const setPanelSource = vi.fn();
  const view = render(<PreviewControls
    sourceMonitorActive={false} sourceMonitorFileName={null} closeSourceMonitor={vi.fn()}
    editMode={false} canEdit setEditMode={vi.fn()} showEditViewControls={false}
    sceneObjectOverlayEnabled setSceneObjectOverlayEnabled={vi.fn()}
    viewZoom={1} resetView={vi.fn()} source={{ type: 'activeComp' }} sourceLabel="Active"
    activeCompositionId={null} activeCompositionVideoTracks={[]} selectorOpen
    setSelectorOpen={vi.fn()} setSceneGizmoToolbarTarget={vi.fn()}
    dropdownRef={createRef<HTMLDivElement>()} dropdownStyle={{}}
    compositions={compositions} setPanelSource={setPanelSource}
  />);
  return { ...view, setPanelSource };
}

describe('preview composition layer groups', () => {
  it('expands only the hovered composition and stays expanded over its layers', () => {
    mountSelector();
    const compA = screen.getByRole('button', { name: 'Comp A' });
    const group = compA.closest('.preview-comp-source-group')!;
    expect(screen.queryByRole('button', { name: 'A Track' })).toBeNull();
    fireEvent.mouseEnter(compA);
    const layer = screen.getByRole('button', { name: 'A Track' });
    fireEvent.mouseLeave(compA, { relatedTarget: layer });
    fireEvent.mouseEnter(layer);
    expect(screen.queryByRole('button', { name: 'B Track' })).toBeNull();
    expect(layer).toBeVisible();
    fireEvent.mouseLeave(group, { relatedTarget: document.body });
    expect(screen.queryByRole('button', { name: 'A Track' })).toBeNull();
  });

  it('lets keyboard focus reach a layer and collapses when focus leaves its group', () => {
    const { setPanelSource } = mountSelector();
    const compA = screen.getByRole('button', { name: 'Comp A' });
    act(() => compA.focus());
    const layer = screen.getByRole('button', { name: 'A Track' });
    act(() => layer.focus());
    fireEvent.click(layer);
    expect(setPanelSource).toHaveBeenCalledWith({ type: 'layer-index', compositionId: 'A', layerIndex: 0 });
    act(() => screen.getByRole('button', { name: 'Comp B' }).focus());
    expect(screen.queryByRole('button', { name: 'A Track' })).toBeNull();
  });

  it('offers touch disclosure without choosing the composition or retaining pointer focus', () => {
    const { setPanelSource } = mountSelector();
    const disclosure = screen.getByRole('button', { name: 'Show layers for Comp A' });
    fireEvent.pointerDown(disclosure, { pointerType: 'touch' });
    act(() => disclosure.focus());
    fireEvent.pointerUp(disclosure, { pointerType: 'touch' });
    fireEvent.click(disclosure);
    expect(screen.getByRole('button', { name: 'A Track' })).toBeVisible();
    expect(disclosure).not.toHaveFocus();
    expect(setPanelSource).not.toHaveBeenCalled();
  });

  it.each(['same-control', 'next-control'])('recovers keyboard expansion after pointer release outside (%s)', target => {
    mountSelector();
    const comp = screen.getByRole('button', { name: 'Comp A' });
    const group = comp.closest('.preview-comp-source-group')!;
    fireEvent.pointerDown(comp, { pointerType: 'mouse' });
    act(() => comp.focus());
    fireEvent.mouseLeave(group, { relatedTarget: document.body });
    fireEvent.pointerUp(document.body, { pointerType: 'mouse' });
    expect(screen.queryByRole('button', { name: 'A Track' })).toBeNull();

    if (target === 'same-control') {
      fireEvent.keyDown(comp, { key: 'ArrowDown' });
    } else {
      act(() => screen.getByRole('button', { name: 'Show layers for Comp A' }).focus());
    }
    expect(screen.getByRole('button', { name: 'A Track' })).toBeVisible();
  });
});
