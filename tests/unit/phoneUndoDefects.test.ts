import { afterEach, describe, expect, it, vi } from 'vitest';

const repositoryMock = vi.hoisted(() => ({ active: false, sources: [] as string[] }));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/project/repository/transaction/editorMutationRuntime')>();
  return {
    ...actual,
    getEditorRepositorySession: () => (repositoryMock.active ? ({}) as never : null),
    beginEditorTransaction: (label: string, source = 'user') => {
      repositoryMock.sources.push(source);
      return { transactionId: label, owner: Symbol(label), sessionEpoch: 'test' };
    },
  };
});

import { convertRuntimeProjectClip } from '../../src/services/project/projectCompositionSerialization';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import { prepareTimelineMutation } from '../../src/services/project/repository/transaction/domainAdapters/timelineAdapter';
import { decodeProjectDomains, encodeCompositionClip, encodeProjectDomains, trackAudioWorkspaceViewKey } from '../../src/services/project/repository/domains/projectDomains';
import { agentRequestRevisionSource, planRedo, planUndo, type NavigationGraph, type RevisionStep } from '../../src/services/project/repository/transaction/historyNavigationPlan';
import { beginAgentTransaction, runAgentRequestScope } from '../../src/services/aiTools/agentTransaction';
import { resolvePhoneColorScheme } from '../../src/components/mobileSkin/runtime/phoneColorScheme';
import type { ProjectComposition } from '../../src/services/project/projectFileService';
import type { ProjectFile } from '../../src/services/project/types/project.types';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const transform = { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0 }, opacity: 1, blendMode: 'normal' };

describe('node-edit-needs-extra-undo: a freed effect group stays freed in the project record', () => {
  const clip = { id: 'c1', trackId: 'v1', name: 'Clip', startTime: 0, duration: 2, inPoint: 0, outPoint: 2, source: { type: 'video' }, transform,
    effects: [{ id: 'fx', name: 'Box Blur', type: 'box-blur', enabled: false, detached: true, params: {} }] } as unknown as TimelineClip;

  it('keeps detached when a clip becomes a revision (Undo restores the unplugged cable)', () => {
    const saved = convertRuntimeProjectClip(clip, []);
    expect(saved.effects[0]).toMatchObject({ id: 'fx', enabled: false, detached: true });
    // The clip revision record carries it (the nested schema classifies the field as content).
    const record = JSON.stringify([...encodeCompositionClip('main', saved).values()].map(entity => entity.value));
    expect(record).toContain('"detached":true');
    const attached = convertRuntimeProjectClip({ ...clip, effects: [{ ...clip.effects[0], detached: undefined, enabled: true }] }, []);
    expect('detached' in attached.effects[0]).toBe(false);
  });

  it('reads detached back when the project opens', () => {
    const composition = { id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000', folderId: null,
      tracks: [{ id: 'v1', name: 'Video', type: 'video', height: 70, locked: false, visible: true, muted: false, solo: false }],
      clips: [convertRuntimeProjectClip(clip, [])], markers: [] } as unknown as ProjectComposition;
    const effect = convertProjectCompositionToStore([composition])[0].timelineData?.clips[0]?.effects[0];
    expect(effect).toMatchObject({ id: 'fx', detached: true });
  });
});

describe('undo-clears-record-arm: track workspace audio is a view, not track content', () => {
  const audioState = { volumeDb: 0, pan: 0, muted: false, solo: false, recordArm: false, inputMonitor: 'off', effectStack: [], sends: [] };
  const track = { id: 'a1', name: 'Mix 1', type: 'audio', height: 70, locked: false, visible: true, muted: false, solo: false, audioState } as unknown as TimelineTrack;
  const project = { version: 1, name: 'Arm', createdAt: '2026-10-27', updatedAt: 'save-1', settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
    media: [], folders: [], activeCompositionId: 'main', openCompositionIds: ['main'], expandedFolderIds: [],
    compositions: [{ id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000', folderId: null,
      tracks: [track], clips: [], markers: [] }] } as unknown as ProjectFile;
  const timeline = { clips: [], tracks: [track], clipKeyframes: new Map(), markers: [], duration: 10, durationLocked: false, videoBakeRegions: [],
    inPoint: null, outPoint: null, playheadPosition: 0, zoom: 50, scrollX: 0, selectedClipIds: new Set(), selectedKeyframeIds: new Set() } as unknown as TimelineStore;
  const activeComposition = { id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000' } as unknown as Composition;

  it('arming writes the workspace view the project decoder reads, and no content revision', () => {
    const { entities } = encodeProjectDomains(project);
    const armed = { ...track, audioState: { ...audioState, recordArm: true } } as unknown as TimelineTrack;
    const plan = prepareTimelineMutation(timeline, { tracks: [armed] }, { entities, activeComposition });
    const key = trackAudioWorkspaceViewKey('main', 'a1');
    expect(plan.views).toEqual([{ key, value: { recordArm: true, inputMonitor: 'off' } }]);
    // Undo re-decodes the track from its (unarmed) record plus the live workspace: the arm survives.
    const decoded = decodeProjectDomains(entities, { fields: { [key.slice('codec/fields/'.length)]: plan.views[0].value } });
    expect((decoded.compositions[0].tracks[0] as unknown as TimelineTrack).audioState?.recordArm).toBe(true);
  });

  it('a content edit of the track (a send) leaves the workspace view alone', () => {
    const { entities } = encodeProjectDomains(project);
    const sent = { ...track, audioState: { ...audioState, sends: [{ id: 's1', targetBusId: 'bus', gainDb: 0, preFader: false, enabled: true }] } } as unknown as TimelineTrack;
    const plan = prepareTimelineMutation(timeline, { tracks: [sent] }, { entities, activeComposition });
    expect(plan.views).toEqual([]);
    expect(plan.aggregates.length).toBeGreaterThan(0);
  });
});

describe('assistant-request-undo: one assistant request is one Undo step', () => {
  const graphOf = (revisions: Array<[id: string, parent: string | null, source: string, keys?: string[]]>, redo: Record<string, string> = {}): NavigationGraph => {
    const steps = new Map<string, RevisionStep>(revisions.map(([revisionId, parentRevisionId, source, keys]) => [revisionId, { revisionId, parentRevisionId, source, keys: keys ?? [`clip/${revisionId}`] }]));
    const children = new Map<string, string>();
    for (const step of steps.values()) if (step.parentRevisionId) children.set(step.parentRevisionId, step.revisionId);
    return { step: async id => steps.get(id) ?? null, redoChild: async id => redo[id] ?? children.get(id) ?? null, current: () => null };
  };
  const request = agentRequestRevisionSource('run-1');

  it('undo takes back every consecutive revision of the request, also across a background revision', async () => {
    const graph = graphOf([['base', null, 'user'], ['r1', 'base', request], ['bg', 'r1', 'source-identity', ['source-identity:m']], ['r2', 'bg', request], ['r3', 'r2', request]]);
    expect(await planUndo(graph, 'r3')).toMatchObject({ target: 'base', redoChild: 'r1' });
    expect((await planRedo(graph, 'base'))?.target).toBe('r3');
  });

  it('a user edit made while the request ran splits it there, and other requests stay separate', async () => {
    const graph = graphOf([['base', null, 'user'], ['r1', 'base', request], ['own', 'r1', 'gesture'], ['r2', 'own', request]]);
    expect((await planUndo(graph, 'r2'))?.target).toBe('own');
    const two = graphOf([['base', null, 'user'], ['a', 'base', request], ['b', 'a', agentRequestRevisionSource('run-2')]]);
    expect((await planUndo(two, 'b'))?.target).toBe('a');
    const plain = graphOf([['base', null, 'user'], ['t1', 'base', 'agent'], ['t2', 't1', 'agent']]);
    expect((await planUndo(plain, 't2'))?.target).toBe('t1');
  });

  it('agent transactions inside a request carry its source; outside they stay plain agent revisions', async () => {
    repositoryMock.active = true; repositoryMock.sources = [];
    await runAgentRequestScope('run-7', async () => {
      beginAgentTransaction('AI: splitClip');
      await Promise.resolve();
      beginAgentTransaction('AI: setClipSpeed');
    });
    beginAgentTransaction('AI: later');
    expect(repositoryMock.sources).toEqual([agentRequestRevisionSource('run-7'), agentRequestRevisionSource('run-7'), 'agent']);
  });
  afterEach(() => { repositoryMock.active = false; });
});

describe('phone light theme follows every light editor theme', () => {
  const base = { resolveThemeUnlocked: false, customBrightness: 15, systemPrefersDark: true };
  it('light, system on a light device and a bright custom theme give the light phone palette', () => {
    expect(resolvePhoneColorScheme({ ...base, theme: 'light' })).toBe('light');
    expect(resolvePhoneColorScheme({ ...base, theme: 'system', systemPrefersDark: false })).toBe('light');
    expect(resolvePhoneColorScheme({ ...base, theme: 'system' })).toBe('dark');
    expect(resolvePhoneColorScheme({ ...base, theme: 'custom', customBrightness: 80 })).toBe('light');
    expect(resolvePhoneColorScheme({ ...base, theme: 'custom' })).toBe('dark');
    expect(resolvePhoneColorScheme({ ...base, theme: 'midnight' })).toBe('dark');
  });
});
