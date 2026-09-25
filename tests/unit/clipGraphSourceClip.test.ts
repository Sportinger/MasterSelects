import { beforeEach, describe, expect, it } from 'vitest';
import { buildClipNodeGraph, buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { getTemporalSourceBadges } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { describePortText } from '../../src/services/nodeGraph/nodePortPresentation';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { Effect } from '../../src/types/effects';
import type { TimelineClip } from '../../src/types/timeline';
import { installCanvas2DMock } from '../helpers/mockCanvas2d';

beforeEach(() => installCanvas2DMock());

const effect = (id: string, type: string): Effect => ({ id, name: type, type, enabled: true, params: {} } as Effect);
const clip = (source: TimelineClip['source'], effects: Effect[]): TimelineClip => ({
  id: 'clip-1', trackId: 'video-1', name: 'Clip', file: new File([], 'clip.mp4', { type: 'video/mp4' }),
  startTime: 0, duration: 5, inPoint: 0, outPoint: 5, source, transform: structuredClone(DEFAULT_TRANSFORM), effects,
} as TimelineClip);

describe('time effect source clip cable', () => {
  it('connects a video source clip directly to the time effect, past the preceding effects', () => {
    const graph = buildClipNodeGraph(clip({ type: 'video' }, [effect('blur', 'gaussian-blur'), effect('scan', 'slit-scan')]));
    const cable = graph.edges.find(edge => edge.type === 'clip');
    expect(cable).toMatchObject({ fromNodeId: 'source', fromPortId: 'clip', toNodeId: 'effect-scan', toPortId: 'clip', readOnly: true });
    expect(graph.edges.find(edge => edge.toNodeId === 'effect-scan' && edge.toPortId === 'input')?.fromNodeId).toBe('effect-blur');
    expect(getTemporalSourceBadges(graph.nodes.find(node => node.id === 'effect-scan')!)).toEqual([]);
    const port = graph.nodes.find(node => node.id === 'source')!.outputs.find(candidate => candidate.id === 'clip')!;
    expect(describePortText(port)).toMatch(/Time-addressable video/);
  });

  it('adds no clip ports without a time effect', () => {
    const graph = buildClipNodeGraph(clip({ type: 'video' }, [effect('blur', 'gaussian-blur')]));
    expect(graph.nodes.flatMap(node => [...node.inputs, ...node.outputs]).some(port => port.type === 'clip')).toBe(false);
  });

  it('leaves the clip input empty and flags the effect when the source is generated', () => {
    const graph = buildClipNodeGraph(clip({ type: 'motion-shape' } as TimelineClip['source'], [effect('grid', 'invert'), effect('scan', 'slit-scan')]));
    const scan = graph.nodes.find(node => node.id === 'effect-scan')!;
    expect(scan.inputs.some(port => port.id === 'clip')).toBe(true);
    expect(graph.edges.some(edge => edge.type === 'clip')).toBe(false);
    expect(getTemporalSourceBadges(scan)[0]).toMatchObject({ label: 'No source clip', tone: 'empty' });
  });

  it('keeps the clip cable in the unified canvas graph', () => {
    const source = clip({ type: 'video' }, [effect('scan', 'slit-scan')]);
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(source), source);
    expect(graph.edges.some(edge => edge.type === 'clip' && edge.fromNodeId === 'source')).toBe(true);
  });
});
