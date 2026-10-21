import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChromaKeyControls } from '../../src/components/panels/properties/ChromaKeyControls';
import { getDefaultParams } from '../../src/effects';
import { createLegacyChromaKeyGraph } from '../../src/services/operators/legacyChromaKeyEffectGraph';
import { unusedParamWarnings } from '../../src/services/operators/effectParamVisibility';
import { useTimelineStore } from '../../src/stores/timeline';
import { executeAITool } from '../../src/services/aiTools';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createDefaultChromaKeyGraph } from '../../src/services/operators/chromaKeyEffectGraph';
import { getEffectDescriptorsForClip } from '../../src/services/properties/effectProperties';
import { chromaKeyScreenProbeMessage, probeChromaKeyScreen } from '../../src/effects/keying/chroma-key/screenProbe';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); vi.unstubAllGlobals(); });
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

it('lets an edited pre-rebuild graph keyframe the Tolerance it reads, in the inspector and for keyframe tools', () => {
  const setPropertyValue = vi.fn();
  const effect = { id: 'fx', name: 'Chroma Key', type: 'chroma-key', enabled: true, params: { keyColor: 'green', tolerance: .3, softness: .1 }, operatorGraph: edited() };
  const clip = createMockClip({ id: 'c', trackId: 't', duration: 4, effects: [effect as never] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], setPropertyValue,
    clipKeyframes: new Map([['c', [{ id: 'k', clipId: 'c', property: 'effect.fx.tolerance', time: 0, value: .3, easing: 'linear' }]]]) } as never);
  render(<ChromaKeyControls effectId="chroma-key" effectInstanceId="fx" clipId="c" params={effect.params} operatorGraph={effect.operatorGraph} onChange={vi.fn()} />);
  // The keyframed Tolerance row has its keyframe toggle, and an edit goes through the property (not a static write
  // that the keyframes would override at render).
  expect(screen.getAllByTitle(/^Add keyframe/).length).toBeGreaterThanOrEqual(2);
  fireEvent.click(screen.getByRole('button', { name: 'Reset Tolerance' }));
  expect(setPropertyValue).toHaveBeenCalledWith('c', 'effect.fx.tolerance', .2);
  // Keyframe tools see the retired parameters as live properties only where the graph reads them.
  const paths = (target: typeof clip) => getEffectDescriptorsForClip(target).filter(item => item.animatable).map(item => item.path);
  expect(paths(clip)).toEqual(expect.arrayContaining(['effect.fx.tolerance', 'effect.fx.softness']));
  const fresh = { ...clip, effects: [{ ...effect, operatorGraph: undefined }] } as never;
  expect(paths(fresh)).not.toContain('effect.fx.tolerance');
  expect(paths(fresh)).toContain('effect.fx.clipBlack');
});

it('treats an edited new graph as the new keyer and names the controls it no longer reads', () => {
  const graph = createDefaultChromaKeyGraph();
  const node = graph.nodes.find(item => item.bindings.value === 'clipBlack')!;
  node.bindings = {}; node.constants = { value: .4 };
  render(<ChromaKeyControls effectId="chroma-key" params={getDefaultParams('chroma-key')} operatorGraph={graph} onChange={vi.fn()} />);
  expect(screen.queryByText(/edited before the keyer was rebuilt/)).toBeNull();
  expect(screen.getByRole('slider', { name: 'Clip White slider' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('This edited node graph does not read Clip Black, so it has no effect.');
});

it('stores number parameters given as numeric text as numbers, so every reader sees the same value', async () => {
  const clip = createMockClip({ id: 'c', trackId: 't', duration: 4, effects: [] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
  const added = await executeAITool('addEffect', { clipId: 'c', effectType: 'time-stack', params: { count: '12' } }, 'internal');
  const effectId = (added.data as { effectId: string }).effectId;
  await executeAITool('updateEffect', { clipId: 'c', effectId, params: { offset: '0.5', blendMode: 'darken' } }, 'internal');
  expect(useTimelineStore.getState().clips[0].effects[0].params).toMatchObject({ count: 12, offset: .5, blendMode: 'darken' });
});

/** A clip thumbnail decoded by stand-ins for the browser image APIs (jsdom has none): every pixel `rgb`. */
function stubThumbnailDecoding(rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(48 * 27 * 4).map((_value, index) => index % 4 === 3 ? 255 : rgb[index % 4]);
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob() })));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 480, height: 270, close: vi.fn() })));
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn(), getImageData: () => ({ data, width: 48, height: 27 }) }; } });
}

it('says when the clip shows no screen of the chosen colour (inspector and tools); a real screen stays quiet', async () => {
  stubThumbnailDecoding([128, 120, 110]);
  expect(chromaKeyScreenProbeMessage(await probeChromaKeyScreen(['data:grey'], 'green'), 'green')).toMatch(/^No green screen found in this clip/);
  expect(await probeChromaKeyScreen(['data:grey'], 'custom')).toBeUndefined();
  const clip = createMockClip({ id: 'c', trackId: 't', duration: 4, effects: [], thumbnails: ['data:grey-2'] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
  render(<ChromaKeyControls effectId="chroma-key" clipId="c" effectInstanceId="fx" params={getDefaultParams('chroma-key')} onChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No green screen found in this clip.*Choose Blue or Picked color/));
  const added = await executeAITool('addEffect', { clipId: 'c', effectType: 'chroma-key' }, 'internal');
  expect((added.data as { warnings?: string[] }).warnings).toEqual([expect.stringMatching(/^No green screen found/)]);

  stubThumbnailDecoding([70, 170, 80]);
  expect(await probeChromaKeyScreen(['data:green'], 'green')).toBeGreaterThan(.9);
  expect(chromaKeyScreenProbeMessage(await probeChromaKeyScreen(['data:green'], 'blue'), 'blue')).toMatch(/^No blue screen found/);
});
