import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import { encodeAudioBufferToWavBlob } from '../../engine/audio/AudioFileEncoder';
import {
  getTimelineClipAudioSourceFileKey,
  resolveAudibleAudioClip,
} from '../audio/audioClipResolution';
import {
  prepareClipAudioAnalysisInput,
  type PreparedClipAudioAnalysisInput,
} from '../audio/ClipAudioAnalysisOrchestrator';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';

export interface PreparedMuscriptorAudio {
  audioPath: string;
  sourceFingerprint: string;
  processingStateHash: string;
  sourceFileKey: string | null;
  audioClipId: string;
  timelineStart: number;
  duration: number;
  cleanup?: () => Promise<void>;
}

export interface PrepareMuscriptorAudioOptions {
  clips?: readonly TimelineClip[];
  keyframes?: readonly Keyframe[];
  signal?: AbortSignal;
  onRenderProgress?: (percent: number, message: string) => void;
  dependencies?: Partial<MuscriptorAudioPreparationDependencies>;
}

export interface MuscriptorAudioPreparationDependencies {
  prepareInput(request: Parameters<typeof prepareClipAudioAnalysisInput>[0]): Promise<PreparedClipAudioAnalysisInput | null>;
  encodeWav(buffer: AudioBuffer): Blob;
  nativeClient: MuscriptorAudioStagingClient;
  createId(): string;
}

export interface MuscriptorAudioStagingClient {
  isConnected(): boolean;
  connect(): Promise<boolean>;
  getProjectRoot(timeoutMs?: number): Promise<string | null>;
  createDir(path: string, recursive?: boolean): Promise<boolean>;
  writeFileBinary(path: string, data: Blob | ArrayBuffer | Uint8Array): Promise<boolean>;
  deleteFile(path: string, recursive?: boolean): Promise<boolean>;
  muscriptor: {
    status(): Promise<{ temp_directory?: string | null }>;
  };
}

const defaultDependencies: MuscriptorAudioPreparationDependencies = {
  prepareInput: prepareClipAudioAnalysisInput,
  encodeWav: encodeAudioBufferToWavBlob,
  nativeClient: NativeHelperClient,
  createId: () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
};

export async function prepareMuscriptorAudio(
  clip: TimelineClip,
  options: PrepareMuscriptorAudioOptions = {},
): Promise<PreparedMuscriptorAudio> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const timelineState = options.clips
    ? null
    : await import('../../stores/timeline').then(({ useTimelineStore }) => useTimelineStore.getState());
  const clips = includeRequestedClip(options.clips ?? timelineState?.clips ?? [clip], clip);
  const resolved = resolveAudibleAudioClip(clips, clip.id);
  if (!resolved) {
    throw new Error(`Clip "${clip.name}" has no readable audio source`);
  }

  const prepared = await dependencies.prepareInput({
    clip: resolved.audioClip,
    keyframes: options.keyframes ?? timelineState?.clipKeyframes.get(resolved.audioClip.id),
    needsProcessed: true,
    signal: options.signal,
    onRenderProgress: (progress) => options.onRenderProgress?.(
      progress.percent,
      progress.message ?? progress.phase,
    ),
  });
  if (!prepared) {
    throw new Error(`Could not prepare audible audio for "${resolved.audioClip.name}"`);
  }
  if (!prepared.clipAudioStateHash) {
    throw new Error('Processed MuScriptor audio is missing its timeline-state fingerprint');
  }
  if (options.signal?.aborted) {
    throw new DOMException('MuScriptor audio preparation was cancelled', 'AbortError');
  }

  await ensureNativeHelperConnected(dependencies.nativeClient);
  const stagingDirectories = await resolveStagingDirectories(dependencies.nativeClient);
  const fileName = `muscriptor-${safeId(dependencies.createId())}.wav`;
  const wav = dependencies.encodeWav(prepared.analysisBuffer);
  let audioPath: string | null = null;
  for (const stagingDirectory of stagingDirectories) {
    if (!(await dependencies.nativeClient.createDir(stagingDirectory, true))) continue;
    const candidatePath = joinNativePath(stagingDirectory, fileName);
    if (await dependencies.nativeClient.writeFileBinary(candidatePath, wav)) {
      audioPath = candidatePath;
      break;
    }
  }
  if (!audioPath) {
    throw new Error(
      `Native Helper could not stage MuScriptor audio in: ${stagingDirectories.join(', ')}`,
    );
  }
  if (options.signal?.aborted) {
    await dependencies.nativeClient.deleteFile(audioPath, false);
    throw new DOMException('MuScriptor audio preparation was cancelled', 'AbortError');
  }

  let cleaned = false;
  return {
    audioPath,
    sourceFingerprint: prepared.sourceFingerprint,
    processingStateHash: prepared.clipAudioStateHash,
    sourceFileKey: getTimelineClipAudioSourceFileKey(resolved.audioClip),
    audioClipId: resolved.audioClip.id,
    timelineStart: resolved.audioClip.startTime,
    duration: prepared.analysisBuffer.duration,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await dependencies.nativeClient.deleteFile(audioPath, false);
    },
  };
}

async function ensureNativeHelperConnected(client: MuscriptorAudioStagingClient): Promise<void> {
  if (client.isConnected()) return;
  if (!(await client.connect())) {
    throw new Error('Native Helper is not connected');
  }
}

async function resolveStagingDirectories(client: MuscriptorAudioStagingClient): Promise<string[]> {
  const directories: string[] = [];
  try {
    const status = await client.muscriptor.status();
    if (status.temp_directory?.trim()) directories.push(status.temp_directory.trim());
  } catch {
    // The project-root fallback also supports older helpers during upgrades.
  }

  const projectRoot = await client.getProjectRoot(5_000);
  if (projectRoot) {
    directories.push(joinNativePath(projectRoot, '.masterselects', 'tmp', 'muscriptor'));
  }
  if (directories.length === 0) {
    throw new Error('Native Helper did not provide a MuScriptor temp directory or project root');
  }
  return [...new Set(directories)];
}

function includeRequestedClip(clips: readonly TimelineClip[], requested: TimelineClip): TimelineClip[] {
  return clips.some(candidate => candidate.id === requested.id)
    ? [...clips]
    : [...clips, requested];
}

function joinNativePath(root: string, ...parts: string[]): string {
  const separator = root.includes('\\') ? '\\' : '/';
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''));
  return [cleanRoot, ...cleanParts].join(separator);
}

function safeId(value: string): string {
  const sanitized = value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return sanitized || `${Date.now()}`;
}
