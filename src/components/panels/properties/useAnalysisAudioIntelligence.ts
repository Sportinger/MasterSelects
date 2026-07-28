import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { blobToArrayBuffer } from '../../../artifacts';
import type { AudioAnalysisArtifact, AudioAnalysisArtifactKind } from '../../../services/audio/audioArtifactTypes';
import { decodeDenseCurvePayload } from '../../../services/audio/denseCurvePayload';
import type { ProsodyContourManifest } from '../../../services/audio/prosodyContourManifest';
import { createCurrentAudioArtifactStore } from '../../../services/audio/timelineWaveformPyramidCache';
import { loadAudioIntelligencePayloads } from '../../../services/agentTimeline/artifacts/audioIntelligencePayloadLoader';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnalysisWorkspaceAudioInput } from './analysisWorkspace/analysisWorkspaceAdapter';
import type { AnalysisTranscriptChunkPause } from './analysisWorkspace/analysisTranscriptChunks';
import type { AnalysisSceneSpeechMarker } from './analysisWorkspace/analysisSceneViewModel';
import type { AnalysisSceneSparklineCurve } from './analysisWorkspace/AnalysisSceneSparkline';

export type AnalysisAudioIntelligenceStatus = 'none' | 'partial' | 'ready';

export interface AnalysisAudioFeatureStatus {
  id: 'vad' | 'alignment' | 'markers' | 'prosody' | 'room-tone';
  label: string;
  present: boolean;
  createdAt?: number;
}

export interface AnalysisAudioSpeechMarker extends AnalysisSceneSpeechMarker {
  text?: string;
}

const FEATURES = [
  { id: 'vad', label: 'VAD', kind: 'voice-activity', ref: 'voiceActivityId' },
  { id: 'alignment', label: 'Alignment', kind: 'transcript-timing', ref: 'transcriptTimingId' },
  { id: 'markers', label: 'Markers', kind: 'speech-markers', ref: 'speechMarkersId' },
  { id: 'prosody', label: 'Prosody', kind: 'prosody-contour', ref: 'prosodyContourId' },
  { id: 'room-tone', label: 'Room tone', kind: 'room-tone-profile', ref: 'roomToneProfileId' },
] as const;

function isAudioBearing(sourceType: string | undefined, fileType: string | undefined): boolean {
  return sourceType === 'audio' || sourceType === 'video'
    || Boolean(fileType?.startsWith('audio/') || fileType?.startsWith('video/'));
}

function deriveVadPauses(
  segments: readonly { start: number; end: number }[],
): readonly AnalysisTranscriptChunkPause[] {
  const speech = segments
    .filter(segment => Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && segment.end > segment.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  if (speech.length < 2) return [];
  const pauses: AnalysisTranscriptChunkPause[] = [];
  let speechEnd = speech[0].end;
  for (const segment of speech.slice(1)) {
    if (segment.start - speechEnd >= 0.5) {
      pauses.push({ start: speechEnd, end: segment.start });
    }
    speechEnd = Math.max(speechEnd, segment.end);
  }
  return pauses;
}

export function useAnalysisAudioIntelligence(clipId: string) {
  const clipState = useTimelineStore(useShallow((state) => {
    const clip = state.clips.find(candidate => candidate.id === clipId);
    const refs = clip?.audioState?.sourceAnalysisRefs;
    return {
      hasAudio: Boolean(clip && isAudioBearing(clip.source?.type, clip.file?.type)),
      job: clip?.audioAnalysisJob,
      loudnessEnvelopeId: refs?.loudnessEnvelopeId,
      voiceActivityId: refs?.voiceActivityId,
      transcriptTimingId: refs?.transcriptTimingId,
      speechMarkersId: refs?.speechMarkersId,
      prosodyContourId: refs?.prosodyContourId,
      roomToneProfileId: refs?.roomToneProfileId,
      generate: state.generateAudioIntelligenceForClip,
      cancelJob: state.cancelAudioAnalysisForClip,
    };
  }));
  const [artifacts, setArtifacts] = useState<readonly AudioAnalysisArtifact[]>([]);
  const [lanes, setLanes] = useState<AnalysisWorkspaceAudioInput>();
  const [markers, setMarkers] = useState<readonly AnalysisAudioSpeechMarker[]>([]);
  const [pauses, setPauses] = useState<readonly AnalysisTranscriptChunkPause[]>([]);
  const [energyCurve, setEnergyCurve] = useState<AnalysisSceneSparklineCurve>();

  useEffect(() => {
    let cancelled = false;
    if (!clipState.hasAudio) {
      setArtifacts([]);
      setLanes(undefined);
      setMarkers([]);
      setPauses([]);
      setEnergyCurve(undefined);
      return () => { cancelled = true; };
    }
    setArtifacts([]);
    setLanes(undefined);
    setMarkers([]);
    setPauses([]);
    setEnergyCurve(undefined);
    const ids = [clipState.loudnessEnvelopeId, clipState.voiceActivityId,
      clipState.transcriptTimingId, clipState.speechMarkersId, clipState.prosodyContourId,
      clipState.roomToneProfileId].filter((id): id is string => Boolean(id));
    const store = createCurrentAudioArtifactStore();
    void Promise.all(ids.map(id => store.getAnalysisArtifact(id))).then(async loaded => {
      if (cancelled) return;
      const current = loaded.filter((artifact): artifact is AudioAnalysisArtifact => Boolean(artifact && !artifact.stale));
      const payloads = await loadAudioIntelligencePayloads(current, store);
      if (cancelled) return;
      const prosodyArtifact = current
        .filter(artifact => artifact.kind === 'prosody-contour')
        .toSorted((left, right) => right.createdAt - left.createdAt)[0];
      let nextEnergyCurve: AnalysisSceneSparklineCurve | undefined;
      try {
        const manifest = prosodyArtifact?.metadata?.prosodyContourManifest as
          | ProsodyContourManifest
          | undefined;
        const energyRef = manifest?.curves?.find(curve => curve.metric === 'energy-rms-db');
        if (energyRef) {
          const blob = await store.getPayload(energyRef.payloadRef.artifactId);
          if (cancelled) return;
          if (blob) {
            const decoded = decodeDenseCurvePayload(await blobToArrayBuffer(blob));
            if (decoded.header.metric === 'energy-rms-db') {
              nextEnergyCurve = {
                values: decoded.values,
                hopSeconds: energyRef.hopDuration,
                startSeconds: 0,
              };
            }
          }
        }
      } catch {
        nextEnergyCurve = undefined;
      }
      if (cancelled) return;
      const curve = payloads.loudness?.curves[0];
      const speechMarkers = (payloads.speechMarkers?.markers ?? []).map(marker => ({
        id: marker.id, kind: marker.type, start: marker.start, end: marker.end,
        wordIds: marker.wordIds, text: marker.text, confidence: marker.confidence,
      }));
      const vadSegments = payloads.voiceActivity?.segments ?? [];
      setArtifacts(current);
      setMarkers(speechMarkers);
      setPauses(deriveVadPauses(vadSegments));
      setEnergyCurve(nextEnergyCurve);
      setLanes({
        levels: curve?.windows.map(window => ({
          start: window.start, end: window.end, loudnessDb: window.valueDb,
        })),
        vadSegments: vadSegments.map(segment => ({
          start: segment.start, end: segment.end, probability: segment.confidence,
        })),
        markers: speechMarkers.map(marker => ({
          id: marker.id, kind: marker.kind, time: marker.start, text: marker.text,
          confidence: marker.confidence,
        })),
      });
    }).catch(() => {
      if (!cancelled) {
        setArtifacts([]);
        setLanes(undefined);
        setMarkers([]);
        setPauses([]);
        setEnergyCurve(undefined);
      }
    });
    return () => { cancelled = true; };
  }, [clipId, clipState.hasAudio, clipState.loudnessEnvelopeId, clipState.prosodyContourId,
    clipState.roomToneProfileId, clipState.speechMarkersId, clipState.transcriptTimingId,
    clipState.voiceActivityId]);

  const features = useMemo<readonly AnalysisAudioFeatureStatus[]>(() => FEATURES.map(feature => {
    const artifact = artifacts.find(candidate => candidate.kind === feature.kind as AudioAnalysisArtifactKind);
    return { id: feature.id, label: feature.label, present: Boolean(artifact), createdAt: artifact?.createdAt };
  }), [artifacts]);
  const presentCount = features.filter(feature => feature.present).length;
  const status: AnalysisAudioIntelligenceStatus = presentCount === 0
    ? 'none'
    : presentCount === FEATURES.length ? 'ready' : 'partial';
  const running = clipState.job?.kind === 'audio-intelligence';
  const run = useCallback(
    () => clipState.generate(clipId, { force: status !== 'none' }),
    [clipId, clipState.generate, status],
  );
  const cancel = useCallback(
    () => clipState.cancelJob(clipId),
    [clipId, clipState.cancelJob],
  );

  return {
    lanes,
    markers,
    pauses,
    energyCurve,
    status,
    features,
    hasAudio: clipState.hasAudio,
    progress: clipState.job?.progress ?? 0,
    message: clipState.job?.message,
    run,
    cancel,
    running,
  };
}
