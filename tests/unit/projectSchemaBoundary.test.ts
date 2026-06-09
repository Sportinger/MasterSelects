import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  completeArchitectureGates,
  foundationTypeBoundaryBaselines,
  foundationProjectSchemaImportClassifications,
} from '../../src/architecture';
import { validatePersistedStateRuntimeFree } from '../../src/services/mediaRuntime/persistedStateGuard';
import type {
  ProjectFile,
  ProjectFlashBoardGenerationRecord,
  ProjectFlashBoardState,
  ProjectTextItem,
} from '../../src/services/project/types';

const repoRoot = process.cwd();
const projectTypesRoot = path.join(repoRoot, 'src', 'services', 'project', 'types');
const sourceExtensions = new Set(['.ts']);

const forbiddenProductImportPattern =
  /\.\.\/\.\.\/\.\.\/(stores|components|engine|services|runtime)|@\/(stores|components|engine|services|runtime)/g;
const forbiddenGlobalTypesBarrelPattern =
  /from\s+['"]\.\.\/\.\.\/\.\.\/types['"]|import\(['"]\.\.\/\.\.\/\.\.\/types['"]\)/g;
const runtimeHandlePattern =
  /\b(File|Blob|FileSystemFileHandle|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|AudioContext|VideoFrame|ImageBitmap|GPU[A-Za-z]+|Worker|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL|blob:/g;

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
  return walkFiles(root).filter((filePath) => sourceExtensions.has(path.extname(filePath)));
}

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function makeProjectFile(): ProjectFile {
  const textItem: ProjectTextItem = {
    id: 'text-1',
    name: 'Title',
    type: 'text',
    parentId: null,
    createdAt: 1,
    text: 'Title',
    fontFamily: 'Inter',
    fontSize: 48,
    color: '#ffffff',
    duration: 5,
  };
  const generationRecord: ProjectFlashBoardGenerationRecord = {
    id: 'generation-1',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    request: {
      service: 'kieai',
      providerId: 'kling-3.0',
      version: '3.0',
      outputType: 'video',
      prompt: 'Schema boundary sample',
      referenceMediaFileIds: [],
    },
    job: { status: 'completed' },
    result: {
      mediaFileId: 'media-generated-1',
      mediaType: 'video',
      duration: 5,
    },
  };
  const flashboard: ProjectFlashBoardState = {
    version: 1,
    generationRecords: [generationRecord],
    generationMetadataByMediaId: {
      'media-generated-1': {
        mediaFileId: 'media-generated-1',
        service: 'kieai',
        providerId: 'kling-3.0',
        version: '3.0',
        outputType: 'video',
        mediaType: 'video',
        prompt: 'Schema boundary sample',
        referenceMediaFileIds: [],
        createdAt: '2026-06-09T00:00:00.000Z',
      },
    },
  };

  return {
    version: 1,
    name: 'Schema boundary sample',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
    },
    media: [],
    compositions: [],
    folders: [],
    activeCompositionId: null,
    openCompositionIds: [],
    expandedFolderIds: [],
    textItems: [textItem],
    flashboard,
    uiState: {
      mediaPanelViewMode: 'board',
      audioDisplayMode: 'compact',
      trackFocusMode: 'balanced',
    },
  };
}

describe('project schema boundary', () => {
  it('keeps project DTO files free of product-domain imports', () => {
    const files = sourceFilesUnder(projectTypesRoot);

    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf8');
      const repoPath = toRepoPath(filePath);

      expect(
        countMatches(source, forbiddenProductImportPattern),
        `${repoPath} imports store/component/engine/service/runtime code`,
      ).toBe(0);
      expect(
        countMatches(source, forbiddenGlobalTypesBarrelPattern),
        `${repoPath} imports the broad src/types compatibility barrel`,
      ).toBe(0);
    }

    expect(foundationTypeBoundaryBaselines.projectSchemaProductImportHits).toBe(0);
    expect(foundationProjectSchemaImportClassifications).toHaveLength(0);
  });

  it('keeps project DTO files runtime-handle free', () => {
    const files = sourceFilesUnder(projectTypesRoot);
    let totalHits = 0;

    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf8');
      const repoPath = toRepoPath(filePath);
      const hits = countMatches(source, runtimeHandlePattern);
      totalHits += hits;
      expect(hits, `${repoPath} has runtime-handle tokens`).toBe(0);
    }

    expect(totalHits).toBe(0);
  });

  it('roundtrips a current-schema project DTO without runtime handles', () => {
    const project = makeProjectFile();

    expect(structuredClone(project)).toEqual(project);
    expect(JSON.parse(JSON.stringify(project))).toEqual(project);
    expect(validatePersistedStateRuntimeFree(project)).toMatchObject({
      serializable: true,
      structuredClonePassed: true,
      jsonRoundtripPassed: true,
      violations: [],
    });
  });

  it('marks the P1 project schema gates as satisfied while P2/P3 integration stays active', () => {
    const gates = new Map(completeArchitectureGates.map((gate) => [gate.id, gate.status]));

    expect(gates.get('P1_PROJECT_SCHEMA_NO_STORE_IMPORTS')).toBe('satisfied');
    expect(gates.get('P1_PROJECT_SCHEMA_OWNS_PERSISTED_TYPES')).toBe('satisfied');
    expect(gates.get('P2_STORE_PROJECT_CONTRACT_FREEZE')).toBe('active');
    expect(gates.get('P3_PROJECT_SCHEMA_BOUNDARY')).toBe('satisfied');
  });
});
