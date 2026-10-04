import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import type { ParameterSourceBinding } from '../../src/types/parameterSources';

const mocks = vi.hoisted(() => ({
  state: { clips: [] as unknown[], clipKeyframes: new Map(), playheadPosition: 10.5, isExporting: false, tracks: [] as unknown[] },
  requestNodeAnimation: vi.fn(),
  activatePanelType: vi.fn(),
  setParameterSourceBinding: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));
vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: { getState: () => ({ activatePanelType: mocks.activatePanelType }) },
}));
vi.mock('../../src/services/nodeGraph/nodeWorkspaceNavigation', () => ({
  requestNodeAnimation: mocks.requestNodeAnimation,
}));
vi.mock('../../src/services/parameterSources/parameterSourceActions', () => ({
  setParameterSourceBinding: mocks.setParameterSourceBinding,
}));

const { TransformNodeSourceActions } = await import('../../src/components/panels/properties/transformTab/TransformNodeSourceActions');
const { useTransformNodeSources } = await import('../../src/components/panels/properties/transformTab/useTransformNodeSources');

function setClip(targets: Record<string, ParameterSourceBinding>, operator = 'control.lfo') {
  mocks.state.clips = [{
    id: 'clip', trackId: 'track', startTime: 10, duration: 5, effects: [],
    transform: { opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
      graph: { version: 1, nodes: [createControlNode(operator, 'ik')], edges: [], layout: {} }, targets } },
  }];
}

describe('node-driven transform rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.tracks = [];
  });

  it('lists only active transform bindings', () => {
    setClip({
      'rotation.z': { source: { nodeId: 'ik', portId: 'angle1' } },
      'position.x': { source: { nodeId: 'ik', portId: 'jointX' }, enabled: false },
      'effect.blur.amount': { source: { nodeId: 'ik', portId: 'reach' } },
    }, 'control.ik-two-bone');
    const { result } = renderHook(() => useTransformNodeSources('clip'));
    expect([...result.current.keys()]).toEqual(['rotation.z']);
  });

  it('names the driving port and leads to the source node', () => {
    setClip({ 'rotation.z': { source: { nodeId: 'ik', portId: 'angle1' } } }, 'control.ik-two-bone');
    const sources = new Map([['rotation.z', { nodeId: 'ik', portId: 'angle1' }]]);
    render(<TransformNodeSourceActions clipId="clip" properties={['rotation.z']} sources={sources} />);
    const go = screen.getByRole('button', { name: 'Go to node source of rotation.z' });
    expect(go.className).not.toContain('has-error');
    expect(go.title).toMatch(/^Driven by .+ \/ .+\. Go to source$/);
    fireEvent.click(go);
    expect(mocks.requestNodeAnimation).toHaveBeenCalledWith('clip', 'ik', false);
    expect(mocks.activatePanelType).toHaveBeenCalledWith('node-workspace');
  });

  it('marks a failing source and falls back to the local value on request', () => {
    setClip({ 'rotation.z': { source: { nodeId: 'ik', portId: 'missing' } } }, 'control.ik-two-bone');
    const sources = new Map([['rotation.z', { nodeId: 'ik', portId: 'missing' }]]);
    render(<TransformNodeSourceActions clipId="clip" properties={['rotation.z', 'scale.x']} sources={sources} />);
    const go = screen.getByRole('button', { name: 'Go to node source of rotation.z' });
    expect(go.className).toContain('has-error');
    expect(go.title).toMatch(/^Node source failed: Unknown control output.*Using the keyframe value\.$/);
    fireEvent.click(screen.getByRole('button', { name: 'Use local value for rotation.z' }));
    expect(mocks.setParameterSourceBinding).toHaveBeenCalledTimes(1);
    expect(mocks.setParameterSourceBinding).toHaveBeenCalledWith('clip', 'rotation.z', { enabled: false });
  });

  it('keeps the unlink action disabled on locked tracks', () => {
    setClip({ opacity: { source: { nodeId: 'ik', portId: 'value' } } });
    mocks.state.tracks = [{ id: 'track', locked: true }];
    const sources = new Map([['opacity', { nodeId: 'ik', portId: 'value' }]]);
    render(<TransformNodeSourceActions clipId="clip" properties={['opacity']} sources={sources} />);
    expect(screen.getByRole('button', { name: 'Use local value for opacity' })).toHaveProperty('disabled', true);
  });
});
