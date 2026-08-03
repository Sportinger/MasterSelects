import { describe, expect, it } from 'vitest';

import { buildHostedAgentFastV2BrowserRequest } from '../../src/services/kernelClient/hostedAgent/fastV2BrowserRequest';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    duration: 10,
    id: 'clip-a',
    inPoint: 0,
    linkedClipId: 'clip-b',
    name: 'Interview',
    outPoint: 10,
    startTime: 2,
    trackId: 'track-video',
    ...overrides,
  } as TimelineClip;
}

function track(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    height: 64,
    id: 'track-video',
    muted: false,
    name: 'Video 1',
    solo: false,
    type: 'video',
    visible: true,
    ...overrides,
  };
}

describe('Fast V2 browser request', () => {
  it('includes complete semantic timeline state beside the bounded verification index', async () => {
    const semanticTimelineState = {
      schemaVersion: 1,
      timeline: {
        clips: [{
          effects: [{ id: 'effect-1', type: 'gaussianBlur' }],
          id: 'clip-a',
          textProperties: { color: '#ffffff', text: 'FULL TEXT' },
        }],
      },
    };
    const request = await buildHostedAgentFastV2BrowserRequest({
      clientInstanceId: 'client-1',
      executionProfile: 'verified',
      request: 'Remove the pause from clip-a.',
      requestedExecutionMode: 'normal',
      runSource: 'ui',
      snapshot: {
        clips: [clip(), clip({
          id: 'clip-b',
          linkedClipId: 'clip-a',
          name: 'data:image/png;base64,not-a-real-name',
          startTime: 12,
        })],
        duration: 22,
        inPoint: 1,
        outPoint: 20,
        playheadPosition: 4,
        selectedClipIds: new Set(['clip-a']),
        semanticTimelineState,
        timelineRevision: 7,
        tracks: [track()],
      },
      turnId: 'turn-v2-1',
    });

    expect(request).toMatchObject({
      clientInstanceId: 'client-1',
      compactSnapshot: {
        payload: {
          clips: [
            { id: 'clip-a', name: 'Interview', startTime: 2 },
            { id: 'clip-b', name: '[redacted-data-label]', startTime: 12 },
          ],
          selectedClipIds: ['clip-a'],
          semanticTimelineState,
        },
        schemaVersion: 1,
        timelineRevision: 7,
      },
      editorBuildId: 'masterselects:2.4.5',
      executionProfile: 'verified',
      protocolVersion: 'fast-agent-v2',
      requestedExecutionMode: 'normal',
      turnId: 'turn-v2-1',
      visualReferences: [],
    });
    expect(request.compactSnapshot.stateFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(request)).not.toMatch(
      /systemPrompt|providerInput|toolSchemaVersion|maxTurnSpendCredits|reasoningEffort/,
    );
  });

  it('rejects invalid structural numbers through the shared fingerprint contract', async () => {
    await expect(buildHostedAgentFastV2BrowserRequest({
      clientInstanceId: 'client-1',
      request: 'Inspect the cut.',
      runSource: 'ui',
      snapshot: {
        clips: [clip({ duration: Number.NaN })],
        duration: 10,
        inPoint: null,
        outPoint: null,
        playheadPosition: 0,
        selectedClipIds: new Set(),
        semanticTimelineState: { schemaVersion: 1 },
        timelineRevision: 1,
        tracks: [track()],
      },
      turnId: 'turn-v2-invalid',
    })).rejects.toThrow('timeline fingerprint contains a non-finite number');
  });

  it('projects transcript words into bounded timeline-space evidence without duplicating linked audio', async () => {
    const transcript = [
      {
        id: 'word-1', text: 'Keep', start: 1, end: 1.5,
        alignedStart: 1.1, alignedEnd: 1.4, alignmentConfidence: 0.2,
      },
      {
        id: 'word-2', text: 'remove this', start: 3, end: 4,
        alignedStart: 3.1, alignedEnd: 3.9, alignmentConfidence: 0.9,
      },
      { id: 'word-3', text: 'outside', start: 12, end: 13 },
    ];
    const request = await buildHostedAgentFastV2BrowserRequest({
      clientInstanceId: 'client-1',
      request: 'Remove the words "remove this".',
      runSource: 'ui',
      snapshot: {
        clips: [
          clip({
            duration: 8,
            inPoint: 1,
            outPoint: 9,
            startTime: 10,
            transcript,
          }),
          clip({
            duration: 8,
            id: 'clip-b',
            inPoint: 1,
            linkedClipId: 'clip-a',
            outPoint: 9,
            startTime: 10,
            trackId: 'track-audio',
            transcript,
          }),
        ],
        duration: 20,
        inPoint: null,
        outPoint: null,
        playheadPosition: 10,
        selectedClipIds: new Set(['clip-a']),
        semanticTimelineState: { schemaVersion: 1 },
        timelineRevision: 8,
        tracks: [
          track(),
          track({ id: 'track-audio', name: 'Audio 1', type: 'audio' }),
        ],
      },
      turnId: 'turn-v2-transcript',
    });

    const payload = request.compactSnapshot.payload as {
      clips: Array<{ id: string; transcript?: Record<string, unknown> }>;
    };
    expect(payload.clips[0]?.transcript).toEqual({
      timebase: 'timeline-seconds',
      totalWords: 2,
      truncated: false,
      words: [
        { text: 'Keep', timelineEnd: 10.5, timelineStart: 10 },
        { text: 'remove this', timelineEnd: 12.9, timelineStart: 12.1 },
      ],
    });
    expect(payload.clips[1]?.transcript).toBeUndefined();
  });

  it('projects all hook rows when text-side group metadata is lost', async () => {
    const hookClips = [
      clip({
        id: 'hook-text-1',
        linkedClipId: undefined,
        name: 'Hook 1: FIRST',
        textProperties: {
          text: 'FIRST',
          boxHeight: 110,
          boxWidth: 620,
          boxX: 230,
          boxY: 360,
          fontFamily: 'Arial',
          fontSize: 64,
          fontWeight: 800,
          color: '#ffffff',
          textAlign: 'center',
        } as TimelineClip['textProperties'],
      }),
      clip({
        id: 'hook-bg-1',
        linkedGroupId: 'hook-partial-metadata',
        linkedClipId: undefined,
        name: 'Hook 1 Background',
        motion: {
          shape: { primitive: 'rectangle', size: { w: 700, h: 140 } },
          appearance: { items: [] },
        } as TimelineClip['motion'],
        transform: { position: { x: 0, y: -120 } } as TimelineClip['transform'],
      }),
      clip({
        id: 'hook-text-2',
        linkedClipId: undefined,
        name: 'SECOND',
        textProperties: {
          text: 'SECOND',
          fontFamily: 'Arial',
          fontSize: 64,
          fontWeight: 800,
          color: '#ffffff',
          textAlign: 'center',
        } as TimelineClip['textProperties'],
      }),
      clip({
        id: 'hook-bg-2',
        linkedGroupId: 'hook-partial-metadata',
        linkedClipId: undefined,
        name: 'Hook 2 Background',
        motion: {
          shape: { primitive: 'rectangle', size: { w: 700, h: 140 } },
          appearance: { items: [] },
        } as TimelineClip['motion'],
      }),
    ];
    const request = await buildHostedAgentFastV2BrowserRequest({
      clientInstanceId: 'client-hook',
      request: 'Make the upper bar white.',
      runSource: 'ui',
      snapshot: {
        clips: hookClips,
        duration: 20,
        inPoint: null,
        outPoint: null,
        playheadPosition: 2,
        selectedClipIds: new Set(),
        semanticTimelineState: {
          activeComposition: { height: 1920, id: 'comp-hook', width: 1080 },
          schemaVersion: 1,
          timeline: { clips: hookClips },
        },
        timelineRevision: 9,
        tracks: [track()],
      },
      turnId: 'turn-v2-hook-recovery',
    });
    const payload = request.compactSnapshot.payload as {
      clips: Array<{
        hook?: {
          box?: { height: number; width: number; x: number; y: number };
          center?: { x: number; y: number };
          geometryUnits: string;
          hookId: string;
          role: string;
          rowIndex: number;
        };
      }>;
    };
    const hooks = payload.clips.map((entry) => entry.hook).filter(Boolean);
    expect(hooks).toHaveLength(4);
    expect(new Set(hooks.map((entry) => entry!.hookId)).size).toBe(1);
    expect(hooks.every((entry) => entry!.hookId === 'hook-partial-metadata')).toBe(true);
    expect(hooks.map((entry) => [entry!.role, entry!.rowIndex])).toEqual([
      ['text', 0],
      ['background', 0],
      ['text', 1],
      ['background', 1],
    ]);
    expect(hooks.every((entry) => entry!.geometryUnits === 'composition-pixels')).toBe(true);
    expect(hooks[0]?.box).toEqual({ height: 110, width: 620, x: 230, y: 360 });
    expect(hooks[1]?.center).toEqual({ x: 540, y: 840 });
  });
});
