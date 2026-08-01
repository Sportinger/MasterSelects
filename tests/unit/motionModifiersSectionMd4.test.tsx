import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MotionShapeTab } from '../../src/components/panels/properties/MotionShapeTab';
import { parseMotionModifierStackContract } from '../../src/services/motionDesign/modifiers/contracts';
import { useTimelineStore } from '../../src/stores/timeline';

const initialState = useTimelineStore.getState();

function stack(modifiers: Array<{ id: string; kind: 'random' | 'oscillator'; enabled?: boolean }>) {
  return parseMotionModifierStackContract({
    contract: 'masterselects.motion-modifier-stack', version: 1, revision: 4,
    timeBasis: 'clip-local-seconds', ticksPerSecond: 60,
    modifiers: modifiers.map((modifier, order) => modifier.kind === 'random' ? ({
      id: modifier.id, order, enabled: modifier.enabled ?? true, kind: 'random', seed: 1,
      distribution: 'uniform-signed', targets: [{ path: 'replicator.offset.position.x', operation: 'add', amount: 50 }],
    }) : ({
      id: modifier.id, order, enabled: modifier.enabled ?? true, kind: 'oscillator', waveform: 'sine',
      frequencyHz: 1, cyclesAcrossInstances: 1, phaseDegrees: 0,
      targets: [{ path: 'replicator.offset.position.x', operation: 'add', amount: 50 }],
    })),
  });
}

describe('MotionModifiersSection MD4 authoring', () => {
  let clipId: string;
  let otherShapeId: string;

  beforeEach(() => {
    localStorage.removeItem('masterselects.motionModifiersSection.expanded');
    useTimelineStore.setState({
      ...initialState, clips: [], tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false }], clipKeyframes: new Map(),
    });
    clipId = useTimelineStore.getState().addMotionShapeClip('video-1', 0, { primitive: 'rectangle', duration: 5 })!;
    otherShapeId = useTimelineStore.getState().addMotionShapeClip('video-1', 6, { primitive: 'ellipse', duration: 5 })!;
  });

  afterEach(() => act(() => { useTimelineStore.setState(initialState); }));

  const setStack = (next = stack([{ id: 'random-one', kind: 'random' }, { id: 'osc-one', kind: 'oscillator' }])) => {
    useTimelineStore.getState().updateMotionLayer(clipId, (motion) => ({ ...motion, modifierStack: next }));
  };
  const currentStack = () => useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.modifierStack;
  const renderExpandedTab = () => {
    render(<MotionShapeTab clipId={clipId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifiers' }));
  };

  it('renders existing rows in contract order', () => {
    setStack(); renderExpandedTab();
    expect(screen.getAllByTestId(/motion-modifier-/).map((node) => node.getAttribute('data-testid')))
      .toEqual(['motion-modifier-random-one', 'motion-modifier-osc-one']);
  });

  it('adds a parse-valid revision-one stack with one default target', () => {
    renderExpandedTab();
    fireEvent.change(screen.getByLabelText('Add modifier'), { target: { value: 'random' } });
    const result = currentStack();
    expect(parseMotionModifierStackContract(result)).toEqual(result);
    expect(result).toMatchObject({ revision: 1, modifiers: [{ kind: 'random', targets: [{ path: 'replicator.offset.position.x', operation: 'add', amount: 50 }] }] });
  });

  it('toggles enabled with a parse-valid next revision', () => {
    setStack(stack([{ id: 'random-one', kind: 'random' }])); renderExpandedTab();
    fireEvent.click(screen.getByLabelText('Enable Random modifier'));
    expect(parseMotionModifierStackContract(currentStack())).toMatchObject({ revision: 5, modifiers: [{ enabled: false }] });
  });

  it('reorders and renumbers order fields', () => {
    setStack(); renderExpandedTab();
    fireEvent.click(screen.getByLabelText('Move Oscillator modifier up'));
    expect(currentStack()?.modifiers.map((modifier) => [modifier.id, modifier.order])).toEqual([['osc-one', 0], ['random-one', 1]]);
  });

  it('clears modifierStack when the last modifier is removed', () => {
    setStack(stack([{ id: 'random-one', kind: 'random' }])); renderExpandedTab();
    fireEvent.click(screen.getByLabelText('Remove Random modifier'));
    expect(currentStack()).toBeUndefined();
  });

  it('shows a diagnostic and does not apply invalid amount edits', () => {
    setStack(stack([{ id: 'random-one', kind: 'random' }])); renderExpandedTab();
    fireEvent.click(screen.getByLabelText('Expand Random modifier'));
    // Drive the value through the component's double-click edit mode. A raw
    // mousedown/mousemove drag needs pointer-lock mocks, `buttons`, and
    // `movementX`, and the drag sensitivity is far too low to exceed the
    // 10,000 budget in one gesture (see EditableDraggableNumber.test.tsx).
    fireEvent.doubleClick(screen.getByText('50.00'));
    const input = screen.getByTitle('Enter value');
    fireEvent.change(input, { target: { value: '20000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('motion-modifier-diagnostic').textContent).toContain('must be in');
    expect(currentStack()?.revision).toBe(4);
  });

  it('sets and clears falloff through the parser', () => {
    setStack(stack([{ id: 'random-one', kind: 'random' }])); renderExpandedTab();
    fireEvent.click(screen.getByLabelText('Enable falloff'));
    expect(parseMotionModifierStackContract(currentStack())).toMatchObject({ falloff: { shapeClipId: otherShapeId, shapeRevision: 0 } });
    fireEvent.click(screen.getByLabelText('Enable falloff'));
    expect(parseMotionModifierStackContract(currentStack()).falloff).toBeUndefined();
  });
});
