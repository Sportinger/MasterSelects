import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RenderTargetSnapshot } from '../../src/engine/render/contracts';
import { validatePersistedStateRuntimeFree } from '../../src/services/mediaRuntime/persistedStateGuard';

const repoRoot = process.cwd();
const contractsRoot = path.join(repoRoot, 'src', 'engine', 'render', 'contracts');
const runtimeHandlePattern =
  /\b(File|Blob|FileSystemFileHandle|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|HTMLElement|AudioContext|VideoFrame|ImageBitmap|OffscreenCanvas|Window|GPU[A-Za-z]+|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL/g;
const snapshotFiles = ['renderFrameSnapshot.ts', 'renderTargetSnapshot.ts'];
const runtimeContractFiles = new Set(['renderOutputRouter.ts', 'exportRenderSession.ts']);

function readContract(fileName: string): string {
  return readFileSync(path.join(contractsRoot, fileName), 'utf8');
}

function contractFiles(): string[] {
  return readdirSync(contractsRoot).filter((entry) => entry.endsWith('.ts'));
}

describe('render contract boundaries', () => {
  it('keeps snapshot contracts free of runtime-handle tokens', () => {
    for (const fileName of snapshotFiles) {
      expect(readContract(fileName).match(runtimeHandlePattern), fileName).toBeNull();
    }
  });

  it('allows runtime-handle tokens only in router and session contracts', () => {
    for (const fileName of contractFiles()) {
      const matches = readContract(fileName).match(runtimeHandlePattern);
      if (!matches) continue;
      expect(runtimeContractFiles.has(fileName), `${fileName}: ${matches.join(', ')}`).toBe(true);
    }
  });

  it('exports all primary contracts from the barrel', () => {
    const barrel = readContract('index.ts');
    for (const contractName of [
      'RenderFrameSnapshot',
      'RenderTargetSnapshot',
      'RenderOutputRouter',
      'ExportRenderSession',
    ]) {
      expect(barrel).toMatch(new RegExp(`\\b${contractName}\\b`));
    }
  });

  it('keeps render target snapshots compatible with the persisted-state guard', () => {
    const snapshot: RenderTargetSnapshot = {
      resolution: { width: 1920, height: 1080 },
      targets: [
        {
          id: 'program',
          name: 'Program',
          source: { type: 'activeComp' },
          destinationType: 'canvas',
          enabled: true,
          showTransparencyGrid: false,
          isFullscreen: false,
        },
      ],
      activeCompositionTargetIds: ['program'],
      independentTargetIds: [],
      sliceConfigs: {
        program: {
          targetId: 'program',
          selectedSliceId: 'slice-1',
          slices: [
            {
              id: 'slice-1',
              name: 'Slice 1',
              type: 'slice',
              inverted: false,
              enabled: true,
              inputCorners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
              warp: {
                mode: 'cornerPin',
                corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
              },
            },
          ],
        },
      },
      outputPreview: { activeTab: 'output', previewingTargetId: 'program' },
    };

    expect(validatePersistedStateRuntimeFree(snapshot)).toMatchObject({
      serializable: true,
      structuredClonePassed: true,
      jsonRoundtripPassed: true,
      violations: [],
    });
  });
});
