import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  hasTimelineClipCanvasAudioAnalysisRef,
  isTimelineClipCanvasAudioClip,
} from './timelineClipCanvasAudio';

const SOURCE_TIMING_EPSILON = 0.001;

export interface TimelineClipCanvasPaintVisuals {
  thumbnail: boolean;
  sourceTimingNeedsThumbnail: boolean;
  composition: boolean;
  midiPreview: boolean;
  audioResource: {
    waveformLike: boolean;
    analysisRef: boolean;
  };
  fade: boolean;
}

interface TimelineClipCanvasPaintVisualContributor {
  id: string;
  apply: (clip: TimelinePaintSourceClip, visuals: TimelineClipCanvasPaintVisuals) => void;
}

function createEmptyPaintVisuals(): TimelineClipCanvasPaintVisuals {
  return {
    thumbnail: false,
    sourceTimingNeedsThumbnail: false,
    composition: false,
    midiPreview: false,
    audioResource: {
      waveformLike: false,
      analysisRef: false,
    },
    fade: false,
  };
}

function hasSourceTimingVisuals(clip: TimelinePaintSourceClip): boolean {
  if (clip.reversed) return true;
  const inPoint = clip.inPoint ?? 0;
  if (Math.abs(inPoint) > SOURCE_TIMING_EPSILON) return true;
  if (typeof clip.outPoint !== 'number') return false;
  return Math.abs((clip.outPoint - inPoint) - clip.duration) > SOURCE_TIMING_EPSILON;
}

export const timelineClipCanvasPaintVisualContributors = [
  {
    id: 'thumbnail',
    apply: (clip, visuals) => {
      if ((clip.thumbnails?.length ?? 0) > 0) {
        visuals.thumbnail = true;
        return;
      }
      visuals.thumbnail = (clip.source?.type === 'video' || clip.source?.type === 'image') &&
        Boolean(clip.source.mediaFileId ?? clip.mediaFileId);
    },
  },
  {
    id: 'source-timing-thumbnail',
    apply: (clip, visuals) => {
      visuals.sourceTimingNeedsThumbnail = hasSourceTimingVisuals(clip) && visuals.thumbnail;
    },
  },
  {
    id: 'composition',
    apply: (clip, visuals) => {
      const hasCompositionAudioMixdown = clip.source?.type === 'audio' && (
        (clip.mixdownWaveform?.length ?? 0) > 0 ||
        Boolean(clip.mixdownGenerating) ||
        Boolean(clip.hasMixdownAudio)
      );
      visuals.composition = Boolean(
        clip.isComposition ||
          clip.compositionId ||
          (clip.clipSegments?.length ?? 0) > 0 ||
          (clip.nestedClipBoundaries?.length ?? 0) > 0 ||
          hasCompositionAudioMixdown,
      );
    },
  },
  {
    id: 'midi-preview',
    apply: (clip, visuals) => {
      visuals.midiPreview = (clip.source?.type === 'midi' || clip.trackType === 'midi') &&
        (clip.midiData?.notes?.length ?? 0) > 0;
    },
  },
  {
    id: 'audio-resource',
    apply: (clip, visuals) => {
      const isAudioClip = isTimelineClipCanvasAudioClip(clip);
      visuals.audioResource.waveformLike = isAudioClip && (
        (clip.waveform?.length ?? 0) > 0 ||
        (clip.waveformChannels?.length ?? 0) > 0 ||
        Boolean(clip.waveformGenerating) ||
        clip.waveformProgress !== undefined
      );
      visuals.audioResource.analysisRef = isAudioClip && hasTimelineClipCanvasAudioAnalysisRef(clip);
    },
  },
  {
    id: 'fade',
    apply: (clip, visuals) => {
      visuals.fade = (clip.fade?.keyframes?.length ?? 0) >= 2;
    },
  },
] as const satisfies readonly TimelineClipCanvasPaintVisualContributor[];

export function resolveTimelineClipCanvasPaintVisuals(
  clip: TimelinePaintSourceClip,
): TimelineClipCanvasPaintVisuals {
  const visuals = createEmptyPaintVisuals();
  timelineClipCanvasPaintVisualContributors.forEach((contributor) => {
    contributor.apply(clip, visuals);
  });
  return visuals;
}
