import { describe, expect, it, vi } from 'vitest';
import {
  createClipContextMenuModel,
  executeClipContextMenuAudioAnalysisRegeneration,
  executeClipContextMenuAudioProxyRegeneration,
  executeClipContextMenuClipboardCommand,
  executeClipContextMenuLabelColor,
  executeClipContextMenuProxyGeneration,
  executeClipContextMenuShowInExplorer,
  executeClipContextMenuStemSeparation,
  executeClipContextMenuTimelineCommand,
  executeClipContextMenuTranscription,
  findMediaFileForClip,
  getClipContextMenuDeleteGapTime,
  getClipContextMenuLinkAffectedIds,
  getClipContextMenuTargetClipIds,
  regenerateClipContextMenuThumbnails,
  resolveClipContextMenuLabelTarget,
  type ClipContextMenuClipLike,
} from '../../src/components/timeline/utils/clipContextMenu';

function clip(
  id: string,
  overrides: Partial<ClipContextMenuClipLike> = {},
): ClipContextMenuClipLike {
  return {
    id,
    source: { type: 'video' },
    ...overrides,
  };
}

function clipMap(clips: ClipContextMenuClipLike[]) {
  return new Map(clips.map((entry) => [entry.id, entry]));
}

function createModel(input: Partial<Parameters<typeof createClipContextMenuModel>[0]> = {}) {
  const baseClip = clip('clip-a');
  const map = clipMap([baseClip]);

  return createClipContextMenuModel({
    clipId: baseClip.id,
    clip: baseClip,
    clipMap: map,
    selectedClipIds: new Set([baseClip.id]),
    isClipLocked: () => false,
    canPasteEffects: false,
    canPasteColor: false,
    ...input,
  });
}

describe('clip context menu model', () => {
  it('targets the selected set only when the opened clip is selected', () => {
    expect(getClipContextMenuTargetClipIds('clip-a', new Set(['clip-a', 'clip-b']))).toEqual(['clip-a', 'clip-b']);
    expect(getClipContextMenuTargetClipIds('clip-a', new Set(['clip-b', 'clip-c']))).toEqual(['clip-a']);
    expect(getClipContextMenuTargetClipIds(null, new Set(['clip-a']))).toEqual([]);
  });

  it('expands affected link ids through direct links and manual linked groups', () => {
    const clips = clipMap([
      clip('video', { linkedClipId: 'audio' }),
      clip('audio', { linkedClipId: 'video', source: { type: 'audio' } }),
      clip('group-a', { linkedGroupId: 'clip-link-manual' }),
      clip('group-b', { linkedGroupId: 'clip-link-manual' }),
      clip('multicam-a', { linkedGroupId: 'multicam-1' }),
      clip('multicam-b', { linkedGroupId: 'multicam-1' }),
    ]);

    expect(getClipContextMenuLinkAffectedIds(['video'], clips)).toEqual(['video', 'audio']);
    expect(getClipContextMenuLinkAffectedIds(['group-a'], clips)).toEqual(['group-a', 'group-b']);
    expect(getClipContextMenuLinkAffectedIds(['multicam-a'], clips)).toEqual(['multicam-a']);
  });

  it('derives link, unlink, and lock eligibility from plain clip data', () => {
    const clips = clipMap([
      clip('clip-a'),
      clip('clip-b'),
      clip('clip-c', { linkedClipId: 'clip-a' }),
    ]);

    const unlocked = createModel({
      clipId: 'clip-a',
      clip: clips.get('clip-a'),
      clipMap: clips,
      selectedClipIds: new Set(['clip-a', 'clip-b']),
    });

    expect(unlocked.targetClipIds).toEqual(['clip-a', 'clip-b']);
    expect(unlocked.clipLinkAffectedIds).toEqual(['clip-a', 'clip-b', 'clip-c']);
    expect(unlocked.hasClipLinkTarget).toBe(true);
    expect(unlocked.canModifyTargets).toBe(true);
    expect(unlocked.canLinkClips).toBe(true);
    expect(unlocked.canUnlinkClips).toBe(true);

    const lockedSelection = createModel({
      clipId: 'clip-a',
      clip: clips.get('clip-a'),
      clipMap: clips,
      selectedClipIds: new Set(['clip-a', 'clip-b']),
      isClipLocked: (clipId) => clipId === 'clip-b',
    });

    expect(lockedSelection.hasLockedTarget).toBe(true);
    expect(lockedSelection.canModifyTargets).toBe(false);
    expect(lockedSelection.canLinkClips).toBe(false);

    const lockedLinkedPartner = createModel({
      clipId: 'clip-a',
      clip: clips.get('clip-a'),
      clipMap: clips,
      selectedClipIds: new Set(['clip-a']),
      isClipLocked: (clipId) => clipId === 'clip-c',
    });

    expect(lockedLinkedPartner.hasLockedTarget).toBe(false);
    expect(lockedLinkedPartner.hasLockedClipLinkTarget).toBe(true);
    expect(lockedLinkedPartner.canModifyTargets).toBe(true);
    expect(lockedLinkedPartner.canUnlinkClips).toBe(false);
  });

  it('filters stale selection targets and disables mutations for a missing opened clip', () => {
    const clips = clipMap([
      clip('clip-a'),
      clip('clip-b'),
    ]);

    const selectedWithStaleId = createModel({
      clipId: 'clip-a',
      clip: clips.get('clip-a'),
      clipMap: clips,
      selectedClipIds: new Set(['clip-a', 'stale-clip']),
    });

    expect(selectedWithStaleId.targetClipIds).toEqual(['clip-a']);
    expect(selectedWithStaleId.clipLinkAffectedIds).toEqual(['clip-a']);
    expect(selectedWithStaleId.canModifyTargets).toBe(true);

    const missingOpenedClip = createModel({
      clipId: 'stale-clip',
      clip: null,
      clipMap: clips,
      selectedClipIds: new Set(['stale-clip']),
    });

    expect(missingOpenedClip.targetClipIds).toEqual([]);
    expect(missingOpenedClip.clipLinkAffectedIds).toEqual([]);
    expect(missingOpenedClip.canModifyTargets).toBe(false);
    expect(missingOpenedClip.canLinkClips).toBe(false);
    expect(missingOpenedClip.canUnlinkClips).toBe(false);
  });

  it('treats manual linked groups as unlink targets but ignores multicam groups for clip-link commands', () => {
    const clips = clipMap([
      clip('manual', { linkedGroupId: 'clip-link-group' }),
      clip('multicam', { linkedGroupId: 'multicam-group' }),
    ]);

    expect(createModel({
      clipId: 'manual',
      clip: clips.get('manual'),
      clipMap: clips,
      selectedClipIds: new Set(['manual']),
    }).canUnlinkClips).toBe(true);

    expect(createModel({
      clipId: 'multicam',
      clip: clips.get('multicam'),
      clipMap: clips,
      selectedClipIds: new Set(['multicam']),
    }).canUnlinkClips).toBe(false);
  });

  it('derives effect labels and color clipboard placement by clip kind', () => {
    const video = createModel({
      clip: clip('clip-video', { source: { type: 'video' } }),
      canPasteEffects: true,
      canPasteColor: true,
    });
    expect(video.effectCopyLabel).toBe('Copy Video Effects');
    expect(video.effectPasteLabel).toBe('Paste Video Effects');
    expect(video.showColorClipboardInEffects).toBe(true);
    expect(video.showColorClipboardTopLevel).toBe(false);
    expect(video.canPasteEffects).toBe(true);
    expect(video.canPasteColor).toBe(true);

    const audio = createModel({
      clip: clip('clip-audio', { source: { type: 'audio' } }),
    });
    expect(audio.effectCopyLabel).toBe('Copy Audio Effects');
    expect(audio.effectPasteLabel).toBe('Paste Audio Effects');
    expect(audio.showColorClipboardInEffects).toBe(false);
    expect(audio.showColorClipboardTopLevel).toBe(false);

    const solid = createModel({
      clip: clip('clip-solid', { source: { type: 'solid' } }),
    });
    expect(solid.effectCopyLabel).toBe('Copy Effects');
    expect(solid.effectPasteLabel).toBe('Paste Effects');
    expect(solid.showColorClipboardInEffects).toBe(false);
    expect(solid.showColorClipboardTopLevel).toBe(true);
  });

  it('resolves media files from media ids and audio-suffixed clip names', () => {
    const files = [
      { id: 'media-video', name: 'Video Source.mp4' },
      { id: 'media-audio', name: 'Audio Source.wav' },
    ];

    expect(findMediaFileForClip(clip('clip-video', { mediaFileId: 'media-video' }), files)?.id).toBe('media-video');
    expect(findMediaFileForClip(clip('clip-audio', { name: 'Audio Source.wav (Audio)' }), files)?.id).toBe('media-audio');
    expect(findMediaFileForClip(null, files)).toBeNull();
  });

  it('regenerates thumbnails from data-only media-owned source URLs', async () => {
    const clearSource = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const generateForSourceUrl = vi.fn<(
      mediaFileId: string,
      sourceUrl: string,
      duration: number,
      fileHash?: string,
    ) => Promise<void>>().mockResolvedValue(undefined);

    const result = await regenerateClipContextMenuThumbnails({
      mediaFile: {
        id: 'media-video',
        name: 'Video Source.mp4',
        duration: 12,
        fileHash: 'hash-a',
        url: 'blob:media-source',
      },
      clips: [clip('clip-video', { mediaFileId: 'media-video', duration: 10 })],
      thumbnailCache: { clearSource, generateForSourceUrl },
    });

    expect(result).toMatchObject({ success: true, sourceUrl: 'blob:media-source', duration: 12 });
    expect(clearSource).toHaveBeenCalledWith('media-video');
    expect(generateForSourceUrl).toHaveBeenCalledWith('media-video', 'blob:media-source', 12, 'hash-a');
  });

  it('creates a managed primary URL for thumbnail regeneration when only a file is available', async () => {
    const clearSource = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const generateForSourceUrl = vi.fn<(
      mediaFileId: string,
      sourceUrl: string,
      duration: number,
      fileHash?: string,
    ) => Promise<void>>().mockResolvedValue(undefined);
    const sourceFile = new Blob(['video'], { type: 'video/mp4' });
    const createPrimarySourceUrl = vi.fn(() => 'blob:created-primary');

    const result = await regenerateClipContextMenuThumbnails({
      mediaFile: {
        id: 'media-video',
        name: 'Video Source.mp4',
        file: sourceFile,
      },
      clips: [clip('clip-video', { mediaFileId: 'media-video', duration: 9 })],
      thumbnailCache: { clearSource, generateForSourceUrl },
      createPrimarySourceUrl,
    });

    expect(result).toMatchObject({ success: true, sourceUrl: 'blob:created-primary', duration: 9 });
    expect(createPrimarySourceUrl).toHaveBeenCalledWith('media-video', sourceFile);
    expect(generateForSourceUrl).toHaveBeenCalledWith('media-video', 'blob:created-primary', 9, undefined);
  });

  it('does not clear thumbnails when no source URL or file is available', async () => {
    const clearSource = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const generateForSourceUrl = vi.fn<(
      mediaFileId: string,
      sourceUrl: string,
      duration: number,
      fileHash?: string,
    ) => Promise<void>>().mockResolvedValue(undefined);

    const result = await regenerateClipContextMenuThumbnails({
      mediaFile: {
        id: 'media-video',
        name: 'Video Source.mp4',
      },
      clips: [clip('clip-video', { mediaFileId: 'media-video', duration: 9 })],
      thumbnailCache: { clearSource, generateForSourceUrl },
    });

    expect(result).toEqual({ success: false, reason: 'missing-source-url', duration: 0 });
    expect(clearSource).not.toHaveBeenCalled();
    expect(generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('resolves label color targets from timeline clips and media panel item state', () => {
    const state = {
      compositions: [{ id: 'comp-1', name: 'Comp 1', labelColor: 'purple' as const }],
      files: [{ id: 'media-1', name: 'Video.mp4', labelColor: 'blue' as const }],
      solidItems: [{ id: 'solid-1', name: 'Solid 1', labelColor: 'orange' as const }],
      textItems: [{ id: 'text-1', name: 'Title', labelColor: 'cyan' as const }],
      meshItems: [{ id: 'mesh-1', name: 'Mesh', meshType: 'cube', labelColor: 'green' as const }],
      cameraItems: [{ id: 'camera-1', name: 'Camera', labelColor: 'red' as const }],
      splatEffectorItems: [{ id: 'effector-1', name: 'Effector', labelColor: 'pink' as const }],
    };

    expect(resolveClipContextMenuLabelTarget(clip('comp-clip', { compositionId: 'comp-1' }), state)).toEqual({
      mediaItemId: 'comp-1',
      currentColor: 'purple',
    });
    expect(resolveClipContextMenuLabelTarget(clip('media-clip', { mediaFileId: 'media-1' }), state)).toEqual({
      mediaItemId: 'media-1',
      currentColor: 'blue',
    });
    expect(resolveClipContextMenuLabelTarget(clip('solid-clip', {
      name: 'Solid 1',
      source: { type: 'solid' },
    }), state)).toEqual({
      mediaItemId: 'solid-1',
      currentColor: 'orange',
    });
    expect(resolveClipContextMenuLabelTarget(clip('text-clip', {
      name: 'Title',
      source: { type: 'text' },
    }), state)).toEqual({
      mediaItemId: 'text-1',
      currentColor: 'cyan',
    });
    expect(resolveClipContextMenuLabelTarget(clip('mesh-clip', {
      meshType: 'cube',
      source: { type: 'model' },
    }), state)).toEqual({
      mediaItemId: 'mesh-1',
      currentColor: 'green',
    });
    expect(resolveClipContextMenuLabelTarget(clip('camera-clip', {
      source: { type: 'camera' },
    }), state)).toEqual({
      mediaItemId: 'camera-1',
      currentColor: 'red',
    });
    expect(resolveClipContextMenuLabelTarget(clip('effector-clip', {
      name: 'Effector',
      source: { type: 'splat-effector' },
    }), state)).toEqual({
      mediaItemId: 'effector-1',
      currentColor: 'pink',
    });
    expect(resolveClipContextMenuLabelTarget(null, state)).toEqual({
      mediaItemId: null,
      currentColor: 'none',
    });
  });

  it('executes proxy generation and cancellation through an injected store facade', () => {
    const generateProxy = vi.fn();
    const cancelProxyGeneration = vi.fn();
    const proxyStore = {
      generateProxy,
      cancelProxyGeneration,
    };
    const mediaFile = { id: 'media-video', name: 'Video.mp4' };

    expect(executeClipContextMenuProxyGeneration({
      mediaFile,
      proxyStore,
      action: 'start',
      options: { force: true },
    })).toBe(true);
    expect(generateProxy).toHaveBeenCalledWith('media-video', { force: true });
    expect(cancelProxyGeneration).not.toHaveBeenCalled();

    expect(executeClipContextMenuProxyGeneration({
      mediaFile,
      proxyStore,
      action: 'stop',
    })).toBe(true);
    expect(cancelProxyGeneration).toHaveBeenCalledWith('media-video');

    expect(executeClipContextMenuProxyGeneration({
      mediaFile: null,
      proxyStore,
      action: 'start',
    })).toBe(false);
    expect(generateProxy).toHaveBeenCalledTimes(1);
  });

  it('executes audio proxy regeneration through an injected store facade', () => {
    const generateAudioProxy = vi.fn();
    const proxyStore = { generateAudioProxy };

    expect(executeClipContextMenuAudioProxyRegeneration({
      mediaFile: { id: 'media-audio', name: 'Audio.wav' },
      proxyStore,
      force: true,
    })).toBe(true);
    expect(generateAudioProxy).toHaveBeenCalledWith('media-audio', { force: true });

    expect(executeClipContextMenuAudioProxyRegeneration({
      mediaFile: undefined,
      proxyStore,
      force: false,
    })).toBe(false);
    expect(generateAudioProxy).toHaveBeenCalledTimes(1);
  });

  it('executes transcription through an injected async loader only when allowed', async () => {
    const transcribeClip = vi.fn();
    const loadTranscriber = vi.fn(async () => ({ transcribeClip }));

    await expect(executeClipContextMenuTranscription({
      clipId: 'clip-video',
      transcriptStatus: 'ready',
      loadTranscriber,
    })).resolves.toBe(true);
    expect(loadTranscriber).toHaveBeenCalledTimes(1);
    expect(transcribeClip).toHaveBeenCalledWith('clip-video');

    await expect(executeClipContextMenuTranscription({
      clipId: 'clip-video',
      transcriptStatus: 'transcribing',
      loadTranscriber,
    })).resolves.toBe(false);
    await expect(executeClipContextMenuTranscription({
      clipId: null,
      loadTranscriber,
    })).resolves.toBe(false);
    expect(loadTranscriber).toHaveBeenCalledTimes(1);
  });

  it('executes show-in-explorer and notifies successful results', async () => {
    const showInExplorer = vi.fn(async () => ({ success: true, message: 'Opened file' }));
    const notify = vi.fn();
    const downloadRawFile = vi.fn();

    await expect(executeClipContextMenuShowInExplorer({
      type: 'raw',
      mediaFile: { id: 'media-video', name: 'Video.mp4' },
      showInExplorer,
      notify,
      downloadRawFile,
    })).resolves.toBe(true);

    expect(showInExplorer).toHaveBeenCalledWith('raw', 'media-video');
    expect(notify).toHaveBeenCalledWith('Opened file');
    expect(downloadRawFile).not.toHaveBeenCalled();
  });

  it('falls back to raw file download when explorer cannot open a raw file', async () => {
    const sourceFile = new Blob(['video'], { type: 'video/mp4' });
    const showInExplorer = vi.fn(async () => ({ success: false, message: 'No path' }));
    const notify = vi.fn();
    const downloadRawFile = vi.fn();
    const logDebug = vi.fn();

    await executeClipContextMenuShowInExplorer({
      type: 'raw',
      mediaFile: { id: 'media-video', name: 'Video.mp4', file: sourceFile },
      showInExplorer,
      notify,
      downloadRawFile,
      logDebug,
    });

    expect(notify).not.toHaveBeenCalled();
    expect(downloadRawFile).toHaveBeenCalledWith(sourceFile, 'Video.mp4');
    expect(logDebug).toHaveBeenCalledWith('Downloaded raw file:', 'Video.mp4');
  });

  it('notifies failed show-in-explorer results without a raw file fallback', async () => {
    const showInExplorer = vi.fn(async () => ({ success: false, message: 'Proxy missing' }));
    const notify = vi.fn();
    const downloadRawFile = vi.fn();

    await expect(executeClipContextMenuShowInExplorer({
      type: 'proxy',
      mediaFile: { id: 'media-video', name: 'Video.mp4' },
      showInExplorer,
      notify,
      downloadRawFile,
    })).resolves.toBe(true);

    expect(notify).toHaveBeenCalledWith('Proxy missing');
    expect(downloadRawFile).not.toHaveBeenCalled();
  });

  it('executes label color writes through an injected store facade', () => {
    const setLabelColor = vi.fn();

    expect(executeClipContextMenuLabelColor({
      mediaItemId: 'media-video',
      color: 'green',
      labelStore: { setLabelColor },
    })).toBe(true);
    expect(setLabelColor).toHaveBeenCalledWith(['media-video'], 'green');

    expect(executeClipContextMenuLabelColor({
      mediaItemId: null,
      color: 'none',
      labelStore: { setLabelColor },
    })).toBe(false);
    expect(setLabelColor).toHaveBeenCalledTimes(1);
  });

  it('executes audio analysis regeneration on the resolved audible clip', () => {
    const generateWaveformForClip = vi.fn();
    const generateSpectrogramForClip = vi.fn();
    const resolveAudioClipId = vi.fn(() => 'audio-clip');
    const clips = [clip('video-clip', { linkedClipId: 'audio-clip' })];

    expect(executeClipContextMenuAudioAnalysisRegeneration({
      clipId: 'video-clip',
      clips,
      kind: 'waveform',
      resolveAudioClipId,
      generateWaveformForClip,
      generateSpectrogramForClip,
    })).toBe(true);

    expect(resolveAudioClipId).toHaveBeenCalledWith(clips, 'video-clip');
    expect(generateWaveformForClip).toHaveBeenCalledWith('audio-clip', { force: true });
    expect(generateSpectrogramForClip).not.toHaveBeenCalled();

    expect(executeClipContextMenuAudioAnalysisRegeneration({
      clipId: 'video-clip',
      clips,
      kind: 'spectral',
      resolveAudioClipId,
      generateWaveformForClip,
      generateSpectrogramForClip,
      force: false,
    })).toBe(true);
    expect(generateSpectrogramForClip).toHaveBeenCalledWith('audio-clip', { force: false });
  });

  it('skips audio analysis regeneration when no audible clip is resolved', () => {
    const generateWaveformForClip = vi.fn();
    const generateSpectrogramForClip = vi.fn();

    expect(executeClipContextMenuAudioAnalysisRegeneration({
      clipId: 'video-clip',
      clips: [],
      kind: 'waveform',
      resolveAudioClipId: () => null,
      generateWaveformForClip,
      generateSpectrogramForClip,
    })).toBe(false);

    expect(generateWaveformForClip).not.toHaveBeenCalled();
    expect(generateSpectrogramForClip).not.toHaveBeenCalled();
  });

  it('executes clipboard commands through injected action callbacks', () => {
    const actions = {
      copyClipEffects: vi.fn(),
      pasteClipEffects: vi.fn(),
      copyClipColor: vi.fn(),
      pasteClipColor: vi.fn(),
    };

    expect(executeClipContextMenuClipboardCommand({
      command: 'copy-effects',
      clipId: 'clip-video',
      targetClipIds: ['clip-video', 'clip-b'],
      canExecute: true,
      actions,
    })).toBe(true);
    expect(actions.copyClipEffects).toHaveBeenCalledWith('clip-video');

    expect(executeClipContextMenuClipboardCommand({
      command: 'paste-color',
      clipId: 'clip-video',
      targetClipIds: ['clip-video', 'clip-b'],
      canExecute: true,
      actions,
    })).toBe(true);
    expect(actions.pasteClipColor).toHaveBeenCalledWith(['clip-video', 'clip-b']);

    expect(executeClipContextMenuClipboardCommand({
      command: 'paste-effects',
      clipId: 'clip-video',
      targetClipIds: ['clip-video'],
      canExecute: false,
      actions,
    })).toBe(false);
    expect(actions.pasteClipEffects).not.toHaveBeenCalled();
  });

  it('derives delete-gap command time from the clip start', () => {
    expect(getClipContextMenuDeleteGapTime(clip('clip-a', { startTime: 4 }))).toBe(3.9995);
    expect(getClipContextMenuDeleteGapTime(clip('clip-a', { startTime: 0 }))).toBe(0);
    expect(getClipContextMenuDeleteGapTime(null)).toBe(0);
  });

  it('executes timeline commands through injected action callbacks', () => {
    const actions = {
      splitClipAtPlayhead: vi.fn(),
      rippleDeleteSelection: vi.fn(),
      deleteGapAtTime: vi.fn(),
      linkClips: vi.fn(),
      unlinkClips: vi.fn(),
      convertSolidToMotionShape: vi.fn(() => 'motion-shape'),
      setMulticamDialogOpen: vi.fn(),
      unlinkGroup: vi.fn(),
      toggleClipReverse: vi.fn(),
      createSubcompositionFromSelection: vi.fn(),
      removeClip: vi.fn(),
    };

    expect(executeClipContextMenuTimelineCommand({
      command: 'delete-gap-at-clip-start',
      clip: clip('clip-a', { startTime: 2 }),
      clipId: 'clip-a',
      targetClipIds: ['clip-a', 'clip-b'],
      canExecute: true,
      actions,
    })).toBe(true);
    expect(actions.deleteGapAtTime).toHaveBeenCalledWith(1.9995);

    expect(executeClipContextMenuTimelineCommand({
      command: 'link-clips',
      clip: clip('clip-a'),
      clipId: 'clip-a',
      targetClipIds: ['clip-a', 'clip-b'],
      canExecute: true,
      actions,
    })).toBe(true);
    expect(actions.linkClips).toHaveBeenCalledWith(['clip-a', 'clip-b']);

    expect(executeClipContextMenuTimelineCommand({
      command: 'delete-clip',
      clip: clip('clip-a'),
      clipId: 'clip-a',
      targetClipIds: ['clip-a'],
      canExecute: true,
      actions,
    })).toBe(true);
    expect(actions.removeClip).toHaveBeenCalledWith('clip-a');

    expect(executeClipContextMenuTimelineCommand({
      command: 'toggle-reverse',
      clip: clip('clip-a'),
      clipId: null,
      targetClipIds: ['clip-a'],
      canExecute: true,
      actions,
    })).toBe(false);
    expect(actions.toggleClipReverse).not.toHaveBeenCalled();
  });

  it('executes stem separation through an injected starter only when allowed', () => {
    const startClipStemSeparation = vi.fn(async () => 'job-1');

    expect(executeClipContextMenuStemSeparation({
      clipId: 'clip-video',
      canExecute: true,
      force: true,
      startClipStemSeparation,
    })).toBe(true);
    expect(startClipStemSeparation).toHaveBeenCalledWith('clip-video', { force: true });

    expect(executeClipContextMenuStemSeparation({
      clipId: 'clip-video',
      canExecute: false,
      force: false,
      startClipStemSeparation,
    })).toBe(false);
    expect(executeClipContextMenuStemSeparation({
      clipId: null,
      canExecute: true,
      force: false,
      startClipStemSeparation,
    })).toBe(false);
    expect(startClipStemSeparation).toHaveBeenCalledTimes(1);
  });
});
