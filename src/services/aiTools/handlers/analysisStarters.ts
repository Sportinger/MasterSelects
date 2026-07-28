import type { useTimelineStore } from '../../../stores/timeline';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleStartClipAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }
  if (!clip.file) {
    return { success: false, error: `Source file is unavailable for clip: ${clipId}` };
  }
  const isVideo = clip.file.type.startsWith('video/')
    || /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name);
  if (!isVideo) {
    return { success: false, error: 'Clip analysis requires a video clip.' };
  }

  if (clip.analysisStatus === 'analyzing') {
    return { success: false, error: 'Analysis already in progress for this clip' };
  }

  // Visual feedback: select clip and open analysis tab
  selectClipAndOpenTab(clipId, 'analysis');

  // Import and start analysis (runs in background)
  const { analyzeClip, isAnalysisRunning, getCurrentAnalyzingClipId } = await import('../../clipAnalyzer');
  if (isAnalysisRunning()) {
    return {
      success: false,
      error: `Another clip analysis is already running (${getCurrentAnalyzingClipId() ?? 'unknown clip'}).`,
    };
  }
  void analyzeClip(clipId).catch(() => {
    // The analyzer persists its exact runtime error for getClipAnalysis.
  });

  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      message: 'Analysis started, including browser-local YuNet + SFace. Poll getClipAnalysis for progress, results, or errors.',
    },
  };
}

export async function handleStartClipFaceAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };
  if (!clip.file) return { success: false, error: `Source file is unavailable for clip: ${clipId}` };
  const isVideo = clip.file.type.startsWith('video/')
    || /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name);
  if (!isVideo) return { success: false, error: 'YuNet + SFace analysis requires a video clip.' };

  const { analyzeClip, isAnalysisRunning, getCurrentAnalyzingClipId } = await import('../../clipAnalyzer');
  if (isAnalysisRunning()) {
    return {
      success: false,
      error: `Another clip analysis is already running (${getCurrentAnalyzingClipId() ?? 'unknown clip'}).`,
    };
  }

  selectClipAndOpenTab(clipId, 'analysis');
  void analyzeClip(clipId).catch(() => {
    // analyzeClip persists runtime errors on the clip for getClipFaceAnalysis.
  });

  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      status: 'analyzing',
      message: 'YuNet + SFace analysis started in the browser. Poll getClipFaceAnalysis for progress, results, or an exact module error.',
    },
  };
}

export async function handleStartClipTranscription(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  // Visual feedback: select clip and open transcript tab
  selectClipAndOpenTab(clipId, 'transcript');

  // Import and start transcription (runs in background)
  const { transcribeClip } = await import('../../clipTranscriber');
  transcribeClip(clipId, 'auto'); // Don't await - runs in background

  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      message: 'Transcription started. Check clip details later for results.',
    },
  };
}

const AUDIO_INTELLIGENCE_FEATURES = new Set([
  'vad',
  'alignment',
  'speech-markers',
  'prosody',
  'room-tone',
]);

export async function handleStartClipAudioIntelligence(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const requestedFeatures = args.features;
  if (requestedFeatures !== undefined && !Array.isArray(requestedFeatures)) {
    return { success: false, error: 'features must be an array of audio-intelligence feature names.' };
  }
  const features = requestedFeatures?.map(feature => String(feature));
  if (features?.length === 0) {
    return { success: false, error: 'features must include at least one audio-intelligence feature.' };
  }
  const unsupported = features?.filter(feature => !AUDIO_INTELLIGENCE_FEATURES.has(feature)) ?? [];
  if (unsupported.length) {
    return { success: false, error: `Unsupported audio-intelligence features: ${unsupported.join(', ')}.` };
  }

  selectClipAndOpenTab(clipId, 'analysis');
  const options = {
    ...(features ? { features: new Set(features) } : {}),
    ...(args.force === true ? { force: true } : {}),
  };
  void timelineStore.generateAudioIntelligenceForClip(clipId, options as never).catch(() => {
    // The store action persists job progress and handles its runtime failures.
  });
  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      started: true,
      message: 'Audio intelligence started. Poll getSpeechMarkers and findSilentSections for results.',
    },
  };
}
