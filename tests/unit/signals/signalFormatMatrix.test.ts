import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findSignalFormatFamilyByExtension,
  normalizeSignalAsset,
  SIGNAL_FORMAT_FAMILY_IDS,
  SIGNAL_FORMAT_FAMILY_MATRIX,
  SIGNAL_KINDS,
} from '../../../src/signals';

const repoRoot = process.cwd();
const signalsRoot = path.join(repoRoot, 'src', 'signals');

const requiredExtensions = [
  'obj',
  'fbx',
  'gltf',
  'glb',
  'pdf',
  'svg',
  'dxf',
  'step',
  'json',
  'csv',
  '*',
  'ply',
  'pcd',
  'las',
  'laz',
  'splat',
] as const;

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((entry) => {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walkFiles(fullPath);
    return [fullPath];
  });
}

function sourceFilesUnder(root: string): string[] {
  return walkFiles(root).filter((filePath) => /\.ts$/.test(filePath));
}

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

describe('signal format matrix', () => {
  it('covers every June 2026 target file family without unsupported-file routing', () => {
    const ids = new Set(SIGNAL_FORMAT_FAMILY_IDS);
    expect(ids).toEqual(new Set([
      'model-3d',
      'document-pdf-svg',
      'cad-technical',
      'data-json-csv',
      'binary-unknown',
      'point-cloud',
    ]));

    const allExtensions = new Set(
      SIGNAL_FORMAT_FAMILY_MATRIX.flatMap((family) => family.extensions),
    );
    for (const extension of requiredExtensions) {
      expect(allExtensions.has(extension), `${extension} is missing from the signal format matrix`).toBe(true);
    }

    const signalKinds = new Set(SIGNAL_KINDS);
    for (const family of SIGNAL_FORMAT_FAMILY_MATRIX) {
      expect(family.fallback.unsupportedPolicy).toBe('never-unsupported');
      expect(family.materialization.timeline).toBeTruthy();
      expect(family.materialization.preview).toBeTruthy();
      expect(family.materialization.export).toBeTruthy();
      expect(family.fixtureTargets.length, `${family.id} needs fixture ownership`).toBeGreaterThan(0);
      expect(family.fallback.binaryFallbackIsFinalRendererSupport).toBe(false);
      for (const kind of family.signalKinds) {
        expect(signalKinds.has(kind), `${family.id} uses unknown SignalKind ${kind}`).toBe(true);
      }
    }
  });

  it('maps file names and extensions to the expected signal family contracts', () => {
    expect(findSignalFormatFamilyByExtension('hero.OBJ').id).toBe('model-3d');
    expect(findSignalFormatFamilyByExtension('.fbx').id).toBe('model-3d');
    expect(findSignalFormatFamilyByExtension('scene.glb').signalKinds).toContain('mesh');
    expect(findSignalFormatFamilyByExtension('manual.PDF').id).toBe('document-pdf-svg');
    expect(findSignalFormatFamilyByExtension('schematic.step').id).toBe('cad-technical');
    expect(findSignalFormatFamilyByExtension('points.laz').id).toBe('point-cloud');
    expect(findSignalFormatFamilyByExtension('records.csv').id).toBe('data-json-csv');
    expect(findSignalFormatFamilyByExtension('unknown.zzz').id).toBe('binary-unknown');
  });

  it('keeps signal format contracts and project-shaped signal payloads JSON safe', () => {
    const asset = normalizeSignalAsset({
      id: 'signal:unknown:demo',
      name: 'unknown.zzz',
      source: {
        kind: 'file',
        fileName: 'unknown.zzz',
        extension: 'zzz',
        mimeType: 'application/octet-stream',
        size: 3,
        hash: 'sha256:demo',
        providerId: 'masterselects.import.binary-fallback',
      },
      refs: [
        {
          id: 'signal:unknown:demo:binary',
          kind: 'binary',
          artifactId: 'signal:unknown:demo:artifact:source',
          mimeType: 'application/octet-stream',
        },
      ],
      artifacts: [
        {
          artifactId: 'signal:unknown:demo:artifact:source',
          hash: 'sha256:demo',
          size: 3,
          mimeType: 'application/octet-stream',
          encoding: 'raw',
          sourceRefs: ['signal:unknown:demo:binary'],
        },
      ],
      metadata: {
        formatFamilyId: findSignalFormatFamilyByExtension('unknown.zzz').id,
      },
    }, { now: () => '2026-06-09T00:00:00.000Z' });
    const projectSignalPayload = {
      signals: {
        assets: [asset],
        artifacts: asset.artifacts,
        graphs: [],
        operators: [],
        assetItems: [],
      },
      formatMatrix: SIGNAL_FORMAT_FAMILY_MATRIX,
    };

    expect(structuredClone(projectSignalPayload)).toEqual(projectSignalPayload);
    expect(JSON.parse(JSON.stringify(projectSignalPayload))).toEqual(projectSignalPayload);
  });

  it('keeps src/signals free of live runtime handle types', () => {
    const forbiddenRuntimePatterns = [
      /\bFile\b/,
      /\bBlob\b/,
      /\bFileSystemFileHandle\b/,
      /\bHTML[A-Za-z]*Element\b/,
      /\bVideoFrame\b/,
      /\bImageBitmap\b/,
      /\bGPU[A-Za-z]*\b/,
      /\bAudioContext\b/,
      /\bWebCodecsPlayer\b/,
      /\bNativeDecoder\b/,
      /\bWorker\b/,
      /blob:/,
    ];

    for (const filePath of sourceFilesUnder(signalsRoot)) {
      const source = readFileSync(filePath, 'utf8');
      for (const pattern of forbiddenRuntimePatterns) {
        expect(
          pattern.test(source),
          `${toRepoPath(filePath)} contains runtime handle pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
