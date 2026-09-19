import { describe, expect, it } from 'vitest';

import type { MediaFile } from '../../src/stores/mediaStore';
import {
  ensureSeedanceSourceTranscripts,
  seedanceTranscriptPreflightInternals,
  type SeedanceTranscriptPreflightDependencies,
} from '../../src/services/seedancePreproduction/sourceTranscriptPreflight';

function media(input: Partial<MediaFile> & Pick<MediaFile, 'id' | 'name' | 'type'>): MediaFile {
  return {
    ...input,
    file: input.file ?? new File(['source'], input.name, { type: input.type === 'audio' ? 'audio/wav' : 'video/mp4' }),
  } as MediaFile;
}

describe('Seedance transcript preflight', () => {
  it('waits for every audio-bearing source before returning', async () => {
    let files = [
      media({ id: 'video-1', name: 'Interview.mp4', type: 'video', hasAudio: true, transcriptStatus: 'none' }),
      media({ id: 'silent-1', name: 'Silent.mp4', type: 'video', hasAudio: false, transcriptStatus: 'none' }),
      media({ id: 'audio-1', name: 'Voice.wav', type: 'audio', transcriptStatus: 'ready', transcript: [] }),
    ];
    const listeners = new Set<() => void>();
    const dependencies: SeedanceTranscriptPreflightDependencies = {
      hydrate: async () => undefined,
      readFiles: () => files,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      queue: async (mediaFileId) => {
        setTimeout(() => {
          files = files.map((file) => file.id === mediaFileId
            ? { ...file, transcriptStatus: 'ready' as const, transcript: [] }
            : file);
          listeners.forEach((listener) => listener());
        }, 0);
      },
    };

    await expect(ensureSeedanceSourceTranscripts(undefined, dependencies)).resolves.toEqual({
      mediaCount: 2,
      transcriptCount: 2,
    });
  });

  it('fails before ideation when an untranscribed source file is unavailable', async () => {
    const unavailable = media({
      id: 'video-1',
      name: 'Missing interview.mp4',
      type: 'video',
      hasAudio: true,
      transcriptStatus: 'none',
    });
    unavailable.file = undefined;
    const dependencies: SeedanceTranscriptPreflightDependencies = {
      hydrate: async () => undefined,
      queue: async () => undefined,
      readFiles: () => [unavailable],
      subscribe: () => () => undefined,
    };

    await expect(ensureSeedanceSourceTranscripts(undefined, dependencies))
      .rejects.toThrow(/original source file/i);
  });

  it('hydrates and transcribes only the explicitly selected source files', async () => {
    let files = [
      media({ id: 'selected', name: 'Selected.mp4', type: 'video', hasAudio: true, transcriptStatus: 'none' }),
      media({ id: 'excluded', name: 'Old timeline.mp4', type: 'video', hasAudio: true, transcriptStatus: 'none' }),
    ];
    const hydrated: string[] = [];
    const queued: string[] = [];
    const listeners = new Set<() => void>();
    const dependencies: SeedanceTranscriptPreflightDependencies = {
      hydrate: async (mediaFileId) => { hydrated.push(mediaFileId); },
      readFiles: () => files,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      queue: async (mediaFileId) => {
        queued.push(mediaFileId);
        files = files.map((file) => file.id === mediaFileId
          ? { ...file, transcriptStatus: 'ready' as const, transcript: [] }
          : file);
        queueMicrotask(() => listeners.forEach((listener) => listener()));
      },
    };

    await expect(ensureSeedanceSourceTranscripts(
      undefined,
      dependencies,
      new Set(['selected']),
    )).resolves.toEqual({ mediaCount: 1, transcriptCount: 1 });
    expect(hydrated).toEqual(['selected']);
    expect(queued).toEqual(['selected']);
  });

  it('classifies explicit silent video separately from audio-bearing media', () => {
    expect(seedanceTranscriptPreflightInternals.needsTranscript(media({
      id: 'silent', name: 'Silent.mp4', type: 'video', hasAudio: false,
    }))).toBe(false);
    expect(seedanceTranscriptPreflightInternals.needsTranscript(media({
      id: 'voice', name: 'Voice.wav', type: 'audio',
    }))).toBe(true);
  });
});
