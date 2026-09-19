import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlockTab } from '../../src/components/panels/properties/flock/FlockTab';
import { useTimelineStore } from '../../src/stores/timeline';
import { useDockStore } from '../../src/stores/dockStore';
import { useNodeWorkspaceNavigation } from '../../src/services/nodeGraph/nodeWorkspaceNavigation';
import { flockRuntime } from '../../src/engine/flock/runtime/flockRuntimeApi';
import type { FlockDefinition } from '../../src/types/flock';

const initialTimeline = useTimelineStore.getState();
const initialDock = useDockStore.getState();

function getDefinition(clipId: string): FlockDefinition {
  const definition = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.flock;
  if (!definition) throw new Error('missing flock definition');
  return definition;
}

function nodeIdFor(clipId: string, operator: string): string {
  const node = getDefinition(clipId).nodes.find((candidate) => candidate.operator === operator);
  if (!node) throw new Error(`missing ${operator}`);
  return node.id;
}

async function renderTab(clipId: string) {
  await act(async () => {
    render(<FlockTab clipId={clipId} />);
  });
}

function editNumber(name: string, value: string) {
  fireEvent.doubleClick(screen.getByRole('slider', { name }));
  const input = screen.getByRole('textbox', { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('FlockTab', () => {
  let clipId: string;

  beforeEach(() => {
    useTimelineStore.setState({
      ...initialTimeline,
      clips: [],
      tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false }],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      playheadPosition: 0,
    });
    clipId = useTimelineStore.getState().addFlockClip('video-1', 0, { presetId: 'free-swarm' })!;
  });

  afterEach(() => {
    act(() => {
      useTimelineStore.setState(initialTimeline);
      useDockStore.setState(initialDock);
      useNodeWorkspaceNavigation.setState({ request: null });
      flockRuntime.clearStatus(clipId);
    });
  });

  it('renders exposed controls grouped as authored', async () => {
    await renderTab(clipId);
    expect(screen.getByRole('heading', { name: 'Population' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Behavior' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Cohesion' })).toBeInTheDocument();
    expect(screen.getByLabelText('Color')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Time/ })).toBeInTheDocument();
  });

  it('writes animatable numbers through setPropertyValue with the flock property path', async () => {
    const setPropertyValue = vi.fn();
    useTimelineStore.setState({ setPropertyValue });
    await renderTab(clipId);
    editNumber('Cohesion', '2.5');
    const rulesId = nodeIdFor(clipId, 'flock.rules');
    expect(setPropertyValue).toHaveBeenCalledWith(clipId, `flock.node.${rulesId}.cohesion`, 2.5);
  });

  it('commits structural population edits to the canonical node parameter', async () => {
    await renderTab(clipId);
    editNumber('Population', '1200');
    const emitterId = nodeIdFor(clipId, 'flock.emitter');
    expect(getDefinition(clipId).nodes.find((node) => node.id === emitterId)?.params.count).toBe(1200);
  });

  it('opens the Flock node view from the header', async () => {
    const activatePanelType = vi.fn();
    useDockStore.setState({ activatePanelType });
    await renderTab(clipId);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Nodes' }));
    });
    expect(activatePanelType).toHaveBeenCalledWith('node-workspace');
    expect(useNodeWorkspaceNavigation.getState().request).toMatchObject({ clipId, theme: 'flock' });
    expect(useTimelineStore.getState().selectedClipIds.has(clipId)).toBe(true);
  });

  it('shows an invalid-graph banner with node-scoped diagnostics', async () => {
    const spawnEdge = getDefinition(clipId).edges.find((edge) => edge.to.port === 'spawn')!;
    useTimelineStore.getState().disconnectFlockGraphEdge(clipId, spawnEdge.id);
    await renderTab(clipId);
    expect(screen.getByRole('alert')).toHaveTextContent('Graph invalid — preview shows last valid result, export is blocked');
    expect(screen.getByText(/needs its Spawn input connected/)).toBeInTheDocument();
  });

  it('marks stale bindings as missing parameters and lets them be removed', async () => {
    const definition = structuredClone(getDefinition(clipId));
    definition.exposed.push({
      id: 'fx-stale',
      nodeId: definition.nodes[0].id,
      param: 'noLongerExists',
      label: 'Old Control',
      group: 'Legacy',
      order: 99,
    });
    useTimelineStore.getState().replaceFlockDefinition(clipId, definition);
    await renderTab(clipId);
    expect(screen.getByText('missing parameter')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove control Old Control' }));
    });
    expect(getDefinition(clipId).exposed.some((exposed) => exposed.id === 'fx-stale')).toBe(false);
  });

  it('applies a preset only after inline confirmation', async () => {
    await renderTab(clipId);
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Flock preset' }), { target: { value: 'vortex' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    });
    expect(getDefinition(clipId).presetId).toBe('free-swarm');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    });
    expect(getDefinition(clipId).presetId).toBe('vortex');
  });

  it('shows runtime status published by the flock runtime', async () => {
    await renderTab(clipId);
    await act(async () => {
      flockRuntime.publishStatus({
        clipId,
        state: 'ready',
        requestedCount: 4000,
        simulatedCount: 4000,
        aliveCount: 3990,
        drawnInstances: 3990,
        linkCapacity: 0,
        trailSamples: 0,
        neighborSaturatedCells: 3,
        step: 120,
        targetStep: 120,
        sourceTime: 2,
        stepRate: 60,
        memoryBytes: 1024 * 1024,
        estimatedMemoryBytes: 1024 * 1024,
        phaseTimingsMs: { step: 1.5 },
        cache: {
          checkpointCount: 2,
          checkpointBytes: 2048,
          coveredSourceRange: [0, 2],
          persistedCheckpointCount: 0,
          precomputeProgress: null,
          precomputeRange: null,
          current: true,
        },
        hashes: null,
        diagnostics: [],
        updatedAt: Date.now(),
      });
      await Promise.resolve();
    });
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/3[,.\u202f\u00a0]?990 alive/)).toBeInTheDocument();
    expect(screen.getByText(/Current/)).toBeInTheDocument();
  });
});
