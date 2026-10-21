import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChromaKeyControls } from '../../src/components/panels/properties/ChromaKeyControls';
import { getDefaultParams } from '../../src/effects';
import { createLegacyChromaKeyGraph } from '../../src/services/operators/legacyChromaKeyEffectGraph';
import { unusedParamWarnings } from '../../src/services/operators/effectParamVisibility';
import { useTimelineStore } from '../../src/stores/timeline';
import { executeAITool } from '../../src/services/aiTools';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });
const edited = () => { const graph = createLegacyChromaKeyGraph(); graph.nodes.find(node => node.id === 'outer-tolerance')!.bypassed = true; return graph; };

it('shows the controls an edited pre-rebuild graph reads, and names what needs the new keyer', () => {
  render(<ChromaKeyControls effectId="chroma-key" params={{ keyColor: 'green', tolerance: .35, softness: .2, spillSuppression: .5 }}
    operatorGraph={edited()} onChange={vi.fn()} />);
  for (const label of ['Tolerance', 'Edge Softness (retired)', 'Spill Suppression']) expect(screen.getByRole('slider', { name: `${label} slider` })).toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Clip Black slider' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(/still keys with Tolerance and Edge Softness.*Clip Black\/White, Shrink\/Grow, Spill Method, View/);
});

it('tells tools that the new controls do nothing on an edited pre-rebuild graph', () => {
  const effect = { type: 'chroma-key', params: getDefaultParams('chroma-key'), operatorGraph: edited() };
  expect(unusedParamWarnings(effect, ['clipBlack', 'edgeSoftness', 'view', 'spillMethod', 'screenColor'])).toHaveLength(5);
  expect(unusedParamWarnings(effect, ['keyColor', 'spillSuppression'])).toEqual([]);
  expect(unusedParamWarnings({ type: 'chroma-key', params: getDefaultParams('chroma-key') }, ['clipBlack', 'view'])).toEqual([]);
});

it('reports retired values from the old keyer, the old Custom key, a reversed clip pair and unusable numbers', () => {
  render(<ChromaKeyControls effectId="chroma-key" params={{ keyColor: 'custom', tolerance: .35, softness: .1, spillSuppression: .5,
    clipBlack: .9, clipWhite: .4, edgeSoftness: Number.NaN }} onChange={vi.fn()} />);
  const text = screen.getAllByRole('status').map(item => item.textContent).join(' | ');
  expect(text).toContain('no longer used: Tolerance 0.35.');
  expect(text).not.toContain('old Edge Softness');
  expect(text).toContain('The old Custom key keyed pure green');
  expect(text).toContain('Clip Black is at or above Clip White');
  expect(text).toContain('Not a number, used at its default: Edge Softness.');
});

it('keeps a quiet inspector for a fresh key, and resets the picked screen colour', () => {
  const onChange = vi.fn();
  const params = { ...getDefaultParams('chroma-key'), keyColor: 'custom', screenColor: '#2050c0' };
  render(<ChromaKeyControls effectId="chroma-key" params={params} onChange={onChange} />);
  expect(screen.queryAllByRole('status')).toHaveLength(0);
  expect(screen.getByLabelText('Chroma Key screen color')).toHaveValue('#2050c0');
  fireEvent.click(screen.getByRole('button', { name: 'Reset Screen color' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ screenColor: '#4c9a55' }));
});

it('reports a number parameter that is not a number in the tool result (the render uses the default)', async () => {
  const clip = createMockClip({ id: 'c', trackId: 't', duration: 4, effects: [] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
  const added = await executeAITool('addEffect', { clipId: 'c', effectType: 'chroma-key' }, 'internal');
  const effectId = (added.data as { effectId: string }).effectId;
  const updated = await executeAITool('updateEffect', { clipId: 'c', effectId, params: { clipBlack: 'abc', clipWhite: '0.7' } }, 'internal');
  expect(updated.success).toBe(true);
  expect((updated.data as { warnings?: string[] }).warnings).toEqual([expect.stringMatching(/^clipBlack: "abc" is not a finite number, so the default 0.3 is used/)]);
});
