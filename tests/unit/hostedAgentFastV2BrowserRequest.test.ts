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

describe('Fast V2 compact browser request', () => {
  it('projects only bounded structural editor state and public execution pins', async () => {
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
        timelineRevision: 1,
        tracks: [track()],
      },
      turnId: 'turn-v2-invalid',
    })).rejects.toThrow('timeline fingerprint contains a non-finite number');
  });
});
