import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlockNodeParameters } from '../../src/components/panels/nodes/flock/FlockNodeParameters';
import { useFlockGraphActions } from '../../src/components/panels/nodes/flock/useFlockGraphActions';
import { useTimelineStore } from '../../src/stores/timeline';
import { getFlockOperator } from '../../src/services/flock/operators/flockOperatorRegistry';
import { createFlockProperty } from '../../src/types/flock';

const initial = useTimelineStore.getState();
let clipId: string;
function currentNode() { return useTimelineStore.getState().clips.find(clip => clip.id === clipId)!.flock!.nodes.find(node => node.operator === 'flock.emitter')!; }
function Harness() {
  const clip = useTimelineStore(state => state.clips.find(value => value.id === clipId))!;
  const actions = useFlockGraphActions(clip);
  return <FlockNodeParameters clip={clip} definition={clip.flock!} flockNode={clip.flock!.nodes.find(node => node.operator === 'flock.emitter')!} actions={actions} />;
}
function editNumber(name: string, value: string) {
  fireEvent.doubleClick(screen.getByRole('slider', { name, exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name, exact: true }), { target: { value } });
  fireEvent.keyDown(screen.getByRole('textbox', { name, exact: true }), { key: 'Enter' });
}
describe('Flock nodes in the shared inspector', () => {
  beforeEach(() => {
    useTimelineStore.setState({ ...initial, clips: [], clipKeyframes: new Map(), playheadPosition: 0,
      tracks: [{ id: 'video-1', name: 'Video', type: 'video', height: 70, muted: false, visible: true, solo: false }] });
    clipId = useTimelineStore.getState().addFlockClip('video-1', 0, { presetId: 'free-swarm' })!;
  });
  afterEach(() => { cleanup(); act(() => useTimelineStore.setState(initial)); });
  it('keeps topology parameters integer and bounded, with reset and expose actions', () => {
    render(<Harness />);
    editNumber('Count', '20.8');
    expect(currentNode().params.count).toBe(21);
    editNumber('Count', '-100');
    const descriptor = getFlockOperator('flock.emitter')!.params.find(param => param.id === 'count')!;
    expect(currentNode().params.count).toBe(descriptor.min);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Count' }));
    expect(currentNode().params.count).toBe(descriptor.default);
    const button = screen.getByRole('button', { name: /^(Unexpose|Expose) Count$/ });
    const wasExposed = button.getAttribute('aria-pressed') === 'true';
    fireEvent.click(button);
    expect(useTimelineStore.getState().clips[0].flock!.exposed.some(param => param.nodeId === currentNode().id && param.param === 'count')).toBe(!wasExposed);
  });
  it('resets an animated vector component through its keyframe owner to its actual default', () => {
    const node = currentNode(), property = createFlockProperty(node.id, 'size', 'x');
    useTimelineStore.getState().addKeyframe(clipId, property, 0, 9);
    render(<Harness />);
    editNumber('Size X', '12');
    expect(useTimelineStore.getState().clipKeyframes.get(clipId)!.find(key => key.property === property)!.value).toBe(12);
    const control = screen.getByRole('slider', { name: 'Size X', exact: true }).closest('.resolve-inspector-row')!;
    fireEvent.click(within(control as HTMLElement).getByRole('button', { name: 'Reset X' }));
    const fallback = getFlockOperator('flock.emitter')!.params.find(param => param.id === 'size')!.default as number[];
    expect(useTimelineStore.getState().clipKeyframes.get(clipId)!.find(key => key.property === property)!.value).toBe(fallback[0]);
  });
});
