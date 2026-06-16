import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ProjectRenderGraph,
  RenderCommand,
  RenderGraphDelta,
  RenderGraphTransformTracks,
} from '../../src/engine/render/contracts/workerRenderGraph';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'src', 'engine', 'render', 'contracts', 'workerRenderGraph.ts');
const forbiddenRuntimePattern =
  /\b(React|Zustand|HTMLVideoElement|HTMLImageElement|HTMLCanvasElement|HTMLElement|GPU[A-Za-z]+|VideoFrame|ImageBitmap|File|Blob|Map|Set|Layer\[\]|LayerSource)\b|from ['"].*(stores|WebGPUEngine|RenderDispatcher|types)['"]/g;

function keyframes(value: number) {
  return [{ time: 0, value, easing: 'linear' as const }];
}

const transform: RenderGraphTransformTracks = {
  positionX: keyframes(0),
  positionY: keyframes(0),
  scaleX: keyframes(1),
  scaleY: keyframes(1),
  rotation: keyframes(0),
  opacity: keyframes(1),
};

const graph: ProjectRenderGraph = {
  id: 'project-1',
  version: 1,
  interpolationAuthority: 'worker-keyframes',
  activeCompositionId: 'comp-1',
  compositionIds: ['comp-1'],
  assets: {
    'asset-1': {
      assetId: 'asset-1',
      mediaFileId: 'media-1',
      signalKind: 'video',
      duration: 10,
      intrinsicSize: { x: 1920, y: 1080 },
      providerId: 'provider-1',
    },
  },
  compositions: {
    'comp-1': {
      id: 'comp-1',
      name: 'Program',
      version: 1,
      duration: 10,
      resolution: { x: 1920, y: 1080 },
      background: { r: 0, g: 0, b: 0, a: 1 },
      trackIds: ['track-1'],
      tracks: {
        'track-1': {
          id: 'track-1',
          kind: 'video',
          name: 'V1',
          visible: true,
          muted: false,
          locked: false,
          order: 0,
          clipIds: ['clip-1'],
        },
      },
      clips: {
        'clip-1': {
          id: 'clip-1',
          trackId: 'track-1',
          assetId: 'asset-1',
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          speed: 1,
          visible: true,
          muted: false,
          blendMode: 'normal',
          transform,
          effects: [],
          masks: [],
          incomingTransition: null,
          outgoingTransition: null,
          nestedCompositionId: null,
        },
      },
    },
  },
};

const delta: RenderGraphDelta = {
  projectId: 'project-1',
  baseVersion: 1,
  nextVersion: 2,
  operations: [
    {
      type: 'upsertKeyframes',
      compositionId: 'comp-1',
      clipId: 'clip-1',
      property: 'opacity',
      keyframes: keyframes(0.5),
    },
  ],
};

const command: RenderCommand = {
  type: 'InitGraph',
  graph,
};

describe('worker render graph contracts', () => {
  it('structured-clones and JSON round-trips representative graph commands', () => {
    expect(structuredClone(command)).toEqual(command);
    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
    expect(structuredClone({ type: 'GraphDelta', delta } satisfies RenderCommand)).toEqual({
      type: 'GraphDelta',
      delta,
    });
  });

  it('defines graph deltas with versioned base and next versions', () => {
    expect(delta.baseVersion).toBe(1);
    expect(delta.nextVersion).toBe(2);
    expect(delta.operations[0].type).toBe('upsertKeyframes');
  });

  it('keeps worker graph contracts free of runtime handles and legacy render payloads', () => {
    const source = readFileSync(contractPath, 'utf8');

    expect(source.match(forbiddenRuntimePattern)).toBeNull();
  });
});
