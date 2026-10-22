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
    // Sections of the shared inspector: a disclosure button per authored group.
    expect(screen.getByRole('button', { name: 'Population' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Behavior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Cohesion' })).toBeInTheDocument();
    expect(screen.getByLabelText('Color')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Time & Quality' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Step rate' })).toHaveTextContent('60 Hz');
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

  const pickPreset = (label: string) => {
    act(() => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Flock preset' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: label }));
    });
  };

  it('lists the effect presets first and the other swarms under More swarms', async () => {
    await renderTab(clipId);
    act(() => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Flock preset' }));
    });
    const names = screen.getAllByRole('option').map((option) => option.textContent);
    expect(names.slice(0, 5)).toEqual(['Free Swarm', 'Krill Cloud', 'Follow Path', 'Technical Network', 'Violet Filaments']);
    expect(names).toEqual(expect.arrayContaining(['Vortex', 'Shrimp Pullback', 'Terracotta Sculpture', 'Lilac Sculpture']));
    expect(screen.getByText('More swarms')).toBeInTheDocument();
  });

  it('applies a picked preset at once, in one undo step', async () => {
    await renderTab(clipId);
    pickPreset('Krill Cloud');
    expect(getDefinition(clipId).presetId).toBe('krill-cloud');
    expect(screen.getByRole('combobox', { name: 'Flock preset' })).toHaveTextContent('Krill Cloud');
  });

  it('names the preset of the graph, also after a tool replaced it (the row used to stay on its first preset)', async () => {
    await renderTab(clipId);
    act(() => {
      useTimelineStore.getState().applyFlockPreset(clipId, 'technical-network');
    });
    expect(screen.getByRole('combobox', { name: 'Flock preset' })).toHaveTextContent('Technical Network');
    expect(screen.getByText(/thin lines, with small square markers/)).toBeInTheDocument();
  });

  it('asks before a preset removes node keyframes', async () => {
    const rulesId = nodeIdFor(clipId, 'flock.rules');
    act(() => {
      useTimelineStore.getState().addKeyframe(clipId, `flock.node.${rulesId}.cohesion`, 2, 1);
    });
    await renderTab(clipId);
    pickPreset('Vortex');
    expect(getDefinition(clipId).presetId).toBe('free-swarm');
    expect(screen.getByRole('group', { name: 'Confirm preset' })).toHaveTextContent('node keyframe is removed');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    });
    expect(getDefinition(clipId).presetId).toBe('vortex');
  });

  it('shows runtime status published by the flock runtime in its folded section', async () => {
    await renderTab(clipId);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Simulation status' }));
    });
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
