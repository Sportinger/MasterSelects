import type { ClipCustomNodeDefinition, NodeGraph, NodeGraphEdge, NodeGraphNode, TimelineClip, TimelineTrack } from '../../types';
import type { AudioEffectInstance, MasterAudioState, MediaFileAudioAnalysisRefs } from '../../types/audio';
import { getAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import { createTextLayoutSnapshot } from '../textLayout';
import { getCachedTimelineLoudnessEnvelope } from '../audio/timelineLoudnessEnvelopeCache';
import {
  getCachedTimelineFrequencySummary,
  getCachedTimelinePhaseCorrelation,
} from '../audio/timelineFrequencyPhaseCache';
import {
  getCachedTimelineBeatGrid,
  getCachedTimelineOnsetMap,
} from '../audio/timelineBeatOnsetCache';
import {
  buildAudioRepairSuggestionsFromRefs,
  type AudioRepairSuggestion,
} from '../audio/audioRepairSuggestions';
import { buildClipNodeGraph } from './clipGraphProjection';
import {
  createNodeGraphOwnerClip,
  resolveLinkedClipNodeGraphContext,
} from './clipGraphLinking';

interface AINodeAuthoringProjectContext {
  clips?: TimelineClip[];
  tracks?: TimelineTrack[];
  masterAudioState?: MasterAudioState;
}

const MAX_CONTEXT_CLIPS = 24;
const MAX_CONTEXT_NODES = 48;
const MAX_CONTEXT_EDGES = 96;
const MAX_TEXT_CONTEXT_CHARS = 1200;
const MAX_TEXT_PREVIEW_CHARS = 160;
const MAX_TEXT_LAYOUT_LINES = 24;
const MAX_TEXT_LAYOUT_CHARACTERS = 80;
const MAX_AUDIO_CONTEXT_REFS = 16;
const MAX_AUDIO_CONTEXT_REF_ID_CHARS = 120;
const MAX_AUDIO_CONTEXT_EFFECTS = 16;
const MAX_AUDIO_CONTEXT_PARAMS = 8;
const MAX_AUDIO_CONTEXT_REPAIR_SUGGESTIONS = 6;
const AUDIO_ANALYSIS_SEMANTICS = new Set([
  'waveform',
  'spectrum',
  'frequency-bands',
  'loudness',
  'beats',
  'onsets',
  'phase-correlation',
  'transcript',
  'frequency-summary',
  'audio-metadata',
]);

function truncateContextValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function formatQuoted(value: string, maxLength: number): string {
  return JSON.stringify(truncateContextValue(value, maxLength));
}

function formatPortList(node: NodeGraphNode, direction: 'input' | 'output'): string {
  const ports = direction === 'input' ? node.inputs : node.outputs;
  if (ports.length === 0) {
    return 'none';
  }

  return ports.map((port) => `${port.id}:${port.type}`).join(', ');
}

function formatParamSummary(node: NodeGraphNode): string {
  const entries = Object.entries(node.params ?? {});
  if (entries.length === 0) {
    return 'none';
  }

  return entries
    .slice(0, 10)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function formatCustomParamSchema(definition: ClipCustomNodeDefinition): string {
  const schema = definition.parameterSchema ?? [];
  if (schema.length === 0) {
    return 'none';
  }

  return schema
    .slice(0, 12)
    .map((param) => `${param.id}:${param.type}=default(${String(param.default)}) current(${String(definition.params?.[param.id] ?? param.default)})`)
    .join(', ');
}

function formatNode(node: NodeGraphNode): string {
  return [
    `- ${node.id}`,
    `kind=${node.kind}`,
    `runtime=${node.runtime}`,
    `label="${node.label}"`,
    `inputs=[${formatPortList(node, 'input')}]`,
    `outputs=[${formatPortList(node, 'output')}]`,
    `params=[${formatParamSummary(node)}]`,
  ].join(' ');
}

function formatEdge(edge: NodeGraphEdge): string {
  return `- ${edge.fromNodeId}.${edge.fromPortId} -> ${edge.toNodeId}.${edge.toPortId} (${edge.type})`;
}

function getDirectEdges(graph: NodeGraph, nodeId: string): NodeGraphEdge[] {
  return graph.edges.filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId);
}

function formatClip(clip: TimelineClip, tracksById: Map<string, TimelineTrack>, currentClipId: string): string {
  const track = tracksById.get(clip.trackId);
  return [
    `- ${clip.id}${clip.id === currentClipId ? ' (current)' : ''}`,
    `name="${clip.name}"`,
    `source=${clip.source?.type ?? 'unknown'}`,
    `file="${clip.file?.name ?? 'unknown'}"`,
    `track="${track?.name ?? clip.trackId}"`,
    `start=${clip.startTime}`,
    `duration=${clip.duration}`,
    `effects=${clip.effects.length}`,
    `customNodes=${clip.nodeGraph?.customNodes?.length ?? 0}`,
    clip.textProperties ? `text=${formatQuoted(clip.textProperties.text, MAX_TEXT_PREVIEW_CHARS)}` : '',
    clip.textProperties ? `font=${clip.textProperties.fontFamily}/${clip.textProperties.fontSize}px/${clip.textProperties.fontWeight}` : '',
  ].join(' ');
}

function formatTextBounds(clip: TimelineClip): string {
  const bounds = clip.textProperties?.textBounds;
  if (!bounds) {
    return 'none';
  }

  const vertices = bounds.vertices
    .slice(0, 12)
    .map((vertex) => `${vertex.id}:${vertex.x.toFixed(3)},${vertex.y.toFixed(3)}`)
    .join(' ');
  const omitted = bounds.vertices.length > 12 ? ` ... ${bounds.vertices.length - 12} more` : '';
  return `closed=${bounds.closed} position=${bounds.position.x},${bounds.position.y} vertices=[${vertices}${omitted}]`;
}

function createMeasureContext(clip: TimelineClip): Pick<CanvasRenderingContext2D, 'font' | 'measureText'> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = clip.source?.textCanvas ?? document.createElement('canvas');
  return canvas.getContext('2d');
}

function formatTextLayout(clip: TimelineClip): string {
  const text = clip.textProperties;
  if (!text) {
    return 'none';
  }

  const ctx = createMeasureContext(clip);
  const canvas = clip.source?.textCanvas;
  if (!ctx) {
    return 'unavailable';
  }

  const layout = createTextLayoutSnapshot(
    ctx,
    text,
    canvas?.width ?? 1920,
    canvas?.height ?? 1080,
  );
  const lines = layout.lines.slice(0, MAX_TEXT_LAYOUT_LINES).map((line) => (
    `  - ${line.index}: text=${formatQuoted(line.text, MAX_TEXT_PREVIEW_CHARS)} chars=${line.start}-${line.end} x=${Math.round(line.left)}-${Math.round(line.right)} y=${Math.round(line.y)} width=${Math.round(line.width)}`
  ));
  const omitted = layout.lines.length > lines.length
    ? [`  - ... ${layout.lines.length - lines.length} more lines omitted`]
    : [];
  const characters = layout.characters.slice(0, MAX_TEXT_LAYOUT_CHARACTERS).map((character) => (
    `  - ${character.index}: char=${formatQuoted(character.char, 16)} line=${character.lineIndex} rect=${Math.round(character.left)},${Math.round(character.top)},${Math.round(character.width)},${Math.round(character.height)}`
  ));
  const omittedCharacters = layout.characters.length > characters.length
    ? [`  - ... ${layout.characters.length - characters.length} more characters omitted`]
    : [];

  return [
    `canvas=${layout.canvasWidth}x${layout.canvasHeight} lineHeight=${Number(layout.lineHeightPx.toFixed(2))}`,
    layout.box ? `box=${Math.round(layout.box.x)},${Math.round(layout.box.y)},${Math.round(layout.box.width)},${Math.round(layout.box.height)}` : 'box=none',
    `contentBounds=${Math.round(layout.contentBounds.x)},${Math.round(layout.contentBounds.y)},${Math.round(layout.contentBounds.width)},${Math.round(layout.contentBounds.height)}`,
    'lines:',
    ...lines,
    ...omitted,
    `characters=${layout.characters.length} (full list is available at runtime as context.text.layout.characters; each has rect=[x,y,width,height])`,
    ...characters,
    ...omittedCharacters,
  ].join('\n');
}

function buildTextSourceContext(clip: TimelineClip): string | null {
  const text = clip.textProperties;
  if (!text) {
    return null;
  }

  const canvas = clip.source?.textCanvas;
  return [
    'Text source:',
    `- text=${formatQuoted(text.text, MAX_TEXT_CONTEXT_CHARS)}`,
    `- canvas=${canvas ? `${canvas.width}x${canvas.height}` : 'unknown'}`,
    `- fontFamily=${text.fontFamily}`,
    `- fontSize=${text.fontSize}`,
    `- fontWeight=${text.fontWeight}`,
    `- fontStyle=${text.fontStyle}`,
    `- color=${text.color}`,
    `- align=${text.textAlign}/${text.verticalAlign}`,
    `- lineHeight=${text.lineHeight}`,
    `- letterSpacing=${text.letterSpacing}`,
    `- box=${text.boxEnabled === true ? `${text.boxX ?? 0},${text.boxY ?? 0},${text.boxWidth ?? 'auto'},${text.boxHeight ?? 'auto'}` : 'disabled'}`,
    `- textBounds=${formatTextBounds(clip)}`,
    `- layout:\n${formatTextLayout(clip)}`,
    `- stroke=${text.strokeEnabled ? `${text.strokeColor}/${text.strokeWidth}` : 'disabled'}`,
    `- shadow=${text.shadowEnabled ? `${text.shadowColor}/${text.shadowOffsetX},${text.shadowOffsetY}/${text.shadowBlur}` : 'disabled'}`,
  ].join('\n');
}

function formatAudioRefId(id: string): string {
  return truncateContextValue(id, MAX_AUDIO_CONTEXT_REF_ID_CHARS);
}

function formatAudioRefList(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) {
    return '';
  }

  const visibleIds = ids.slice(0, MAX_AUDIO_CONTEXT_REFS).map(formatAudioRefId);
  const omittedCount = ids.length - visibleIds.length;
  return `spectrograms=${visibleIds.join(',')}${omittedCount > 0 ? `(+${omittedCount} more)` : ''}`;
}

function formatAudioRefs(refs: MediaFileAudioAnalysisRefs | undefined): string {
  if (!refs) {
    return 'none';
  }

  return [
    refs.waveformPyramidId ? `waveform=${formatAudioRefId(refs.waveformPyramidId)}` : '',
    refs.processedWaveformPyramidId ? `processedWaveform=${formatAudioRefId(refs.processedWaveformPyramidId)}` : '',
    formatAudioRefList(refs.spectrogramTileSetIds),
    refs.loudnessEnvelopeId ? `loudness=${formatAudioRefId(refs.loudnessEnvelopeId)}` : '',
    refs.beatGridId ? `beats=${formatAudioRefId(refs.beatGridId)}` : '',
    refs.onsetMapId ? `onsets=${formatAudioRefId(refs.onsetMapId)}` : '',
    refs.phaseCorrelationId ? `phase=${formatAudioRefId(refs.phaseCorrelationId)}` : '',
    refs.transcriptTimingId ? `transcriptTiming=${formatAudioRefId(refs.transcriptTimingId)}` : '',
    refs.frequencySummaryId ? `frequencySummary=${formatAudioRefId(refs.frequencySummaryId)}` : '',
  ].filter(Boolean).join(' ') || 'none';
}

function formatAudioEffectParams(params: AudioEffectInstance['params']): string {
  const entries = Object.entries(params ?? {}).slice(0, MAX_AUDIO_CONTEXT_PARAMS);
  if (entries.length === 0) {
    return 'none';
  }

  return entries.map(([key, value]) => `${key}=${String(value)}`).join(',');
}

function formatAudioEffectStack(effects: readonly AudioEffectInstance[] | undefined): string {
  if (!effects || effects.length === 0) {
    return 'none';
  }

  const visible = effects.slice(0, MAX_AUDIO_CONTEXT_EFFECTS).map((effect, index) => {
    const descriptor = getAudioEffect(effect.descriptorId);
    return [
      `${index + 1}:${effect.id}`,
      `name="${descriptor?.name ?? effect.descriptorId}"`,
      `descriptor=${effect.descriptorId}`,
      `enabled=${effect.enabled !== false}`,
      `automation=${effect.automationMode ?? 'none'}`,
      `params=[${formatAudioEffectParams(effect.params)}]`,
    ].join(' ');
  });
  const omitted = effects.length - visible.length;
  return `${visible.join('; ')}${omitted > 0 ? `; ... ${omitted} more` : ''}`;
}

function roundAudioDb(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(value);
}

function roundAudioValue(value: number, decimals = 4): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(decimals))) : String(value);
}

function formatCachedLoudnessSummary(refId: string | undefined): string {
  if (!refId) {
    return 'none';
  }

  const envelope = getCachedTimelineLoudnessEnvelope(refId);
  if (!envelope) {
    return `ref=${formatAudioRefId(refId)} summary=not-loaded`;
  }

  const summary = envelope.summary;
  const summaryParts = [
    summary?.integratedLufs !== undefined ? `integratedLufs=${roundAudioDb(summary.integratedLufs)}` : '',
    summary?.truePeakDbtp !== undefined ? `truePeakDbtp=${roundAudioDb(summary.truePeakDbtp)}` : '',
    summary?.samplePeakDbfs !== undefined ? `samplePeakDbfs=${roundAudioDb(summary.samplePeakDbfs)}` : '',
    summary?.rmsDbfs !== undefined ? `rmsDbfs=${roundAudioDb(summary.rmsDbfs)}` : '',
  ].filter(Boolean).join(' ') || 'summary=empty';
  const curveParts = envelope.curves
    .slice(0, 8)
    .map((curve) => `${curve.metric}:${curve.pointCount}`)
    .join(',');

  return `ref=${formatAudioRefId(refId)} ${summaryParts} curves=${curveParts || 'none'}`;
}

function formatCachedFrequencySummary(refId: string | undefined): string {
  if (!refId) {
    return 'none';
  }

  const frequency = getCachedTimelineFrequencySummary(refId);
  if (!frequency) {
    return `ref=${formatAudioRefId(refId)} summary=not-loaded`;
  }

  const dominantBand = frequency.summary.dominantBandId ?? 'none';
  const bands = frequency.bands
    .slice(0, 8)
    .map((band) => (
      `${band.bandId}:share=${roundAudioValue(band.energyShare)} rms=${roundAudioDb(band.rmsDb)} peak=${roundAudioDb(band.peakDb)} centroid=${roundAudioValue(band.centroidHz, 1)}`
    ))
    .join(';');

  return [
    `ref=${formatAudioRefId(refId)}`,
    `centroidHz=${roundAudioValue(frequency.summary.spectralCentroidHz, 1)}`,
    `dominantBand=${dominantBand}`,
    `low=${roundAudioValue(frequency.summary.lowEnergyShare)}`,
    `mid=${roundAudioValue(frequency.summary.midEnergyShare)}`,
    `high=${roundAudioValue(frequency.summary.highEnergyShare)}`,
    `bands=${bands || 'none'}`,
  ].join(' ');
}

function formatCachedPhaseCorrelationSummary(refId: string | undefined): string {
  if (!refId) {
    return 'none';
  }

  const phase = getCachedTimelinePhaseCorrelation(refId);
  if (!phase) {
    return `ref=${formatAudioRefId(refId)} summary=not-loaded`;
  }

  return [
    `ref=${formatAudioRefId(refId)}`,
    `avg=${roundAudioValue(phase.summary.averageCorrelation)}`,
    `min=${roundAudioValue(phase.summary.minimumCorrelation)}`,
    `max=${roundAudioValue(phase.summary.maximumCorrelation)}`,
    `negativePct=${roundAudioValue(phase.summary.negativeCorrelationPercent)}`,
    `midSideDb=${roundAudioDb(phase.summary.averageMidSideRatioDb)}`,
    `width=${roundAudioValue(phase.summary.stereoWidth)}`,
    `monoCompatible=${phase.summary.monoCompatible}`,
    `points=${phase.points.length}`,
  ].join(' ');
}

function formatAudioEventPreview(events: readonly { time: number; strength: number; confidence: number }[]): string {
  return events
    .slice(0, 8)
    .map((event) => `${roundAudioValue(event.time, 3)}s:${roundAudioValue(event.strength)}/${roundAudioValue(event.confidence)}`)
    .join(',');
}

function formatCachedBeatGridSummary(refId: string | undefined): string {
  if (!refId) {
    return 'none';
  }

  const beatGrid = getCachedTimelineBeatGrid(refId);
  if (!beatGrid) {
    return `ref=${formatAudioRefId(refId)} summary=not-loaded`;
  }

  return [
    `ref=${formatAudioRefId(refId)}`,
    `tempoBpm=${beatGrid.tempoBpm !== undefined ? roundAudioValue(beatGrid.tempoBpm, 2) : 'unknown'}`,
    `beats=${beatGrid.beatCount}`,
    `confidence=${roundAudioValue(beatGrid.summary.confidence)}`,
    `preview=${formatAudioEventPreview(beatGrid.beats) || 'none'}`,
  ].join(' ');
}

function formatCachedOnsetMapSummary(refId: string | undefined): string {
  if (!refId) {
    return 'none';
  }

  const onsetMap = getCachedTimelineOnsetMap(refId);
  if (!onsetMap) {
    return `ref=${formatAudioRefId(refId)} summary=not-loaded`;
  }

  return [
    `ref=${formatAudioRefId(refId)}`,
    `events=${onsetMap.eventCount}`,
    `avgStrength=${roundAudioValue(onsetMap.summary.averageStrength)}`,
    `peakStrength=${roundAudioValue(onsetMap.summary.peakStrength)}`,
    `preview=${formatAudioEventPreview(onsetMap.onsets) || 'none'}`,
  ].join(' ');
}

function formatRepairSuggestion(suggestion: AudioRepairSuggestion): string {
  const params = Object.entries(suggestion.operation.params)
    .slice(0, MAX_AUDIO_CONTEXT_PARAMS)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',');
  const evidence = Object.entries(suggestion.evidence)
    .slice(0, MAX_AUDIO_CONTEXT_PARAMS)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',');

  return [
    suggestion.kind,
    `severity=${suggestion.severity}`,
    `confidence=${suggestion.confidence}`,
    `label=${formatQuoted(suggestion.label, 96)}`,
    `reason=${formatQuoted(suggestion.reason, 180)}`,
    `operation=${suggestion.operation.editType}`,
    `params=[${params || 'none'}]`,
    `evidence=[${evidence || 'none'}]`,
  ].join(' ');
}

function formatAudioRepairSuggestions(refs: MediaFileAudioAnalysisRefs | undefined): string {
  if (!refs) {
    return 'none';
  }

  const suggestions = buildAudioRepairSuggestionsFromRefs(refs, {
    maxSuggestions: MAX_AUDIO_CONTEXT_REPAIR_SUGGESTIONS,
  });
  if (suggestions.length === 0) {
    return 'none';
  }

  return suggestions.map(formatRepairSuggestion).join('; ');
}

function firstNonEmpty<T>(preferred: T[] | undefined, fallback: T[] | undefined): T[] | undefined {
  return preferred && preferred.length > 0 ? preferred : fallback;
}

function getEffectiveAudioRefs(clip: TimelineClip): MediaFileAudioAnalysisRefs | undefined {
  const source = clip.audioState?.sourceAnalysisRefs;
  const processed = clip.audioState?.processedAnalysisRefs;
  if (!source && !processed) {
    return undefined;
  }

  return {
    waveformPyramidId: processed?.processedWaveformPyramidId ??
      processed?.waveformPyramidId ??
      source?.waveformPyramidId,
    processedWaveformPyramidId: processed?.processedWaveformPyramidId ?? source?.processedWaveformPyramidId,
    spectrogramTileSetIds: firstNonEmpty(processed?.spectrogramTileSetIds, source?.spectrogramTileSetIds),
    loudnessEnvelopeId: processed?.loudnessEnvelopeId ?? source?.loudnessEnvelopeId,
    beatGridId: processed?.beatGridId ?? source?.beatGridId,
    onsetMapId: processed?.onsetMapId ?? source?.onsetMapId,
    phaseCorrelationId: processed?.phaseCorrelationId ?? source?.phaseCorrelationId,
    transcriptTimingId: processed?.transcriptTimingId ?? source?.transcriptTimingId,
    frequencySummaryId: processed?.frequencySummaryId ?? source?.frequencySummaryId,
  };
}

function isAudioPort(port: NodeGraphNode['outputs'][number]): boolean {
  const semanticKind = String(port.metadata?.semanticKind ?? '');
  return port.type === 'audio' ||
    semanticKind.startsWith('audio') ||
    AUDIO_ANALYSIS_SEMANTICS.has(semanticKind);
}

function buildAudioSourceContext(
  clip: TimelineClip,
  graph: NodeGraph,
  track?: TimelineTrack,
  masterAudioState?: MasterAudioState,
): string | null {
  const sourceNode = graph.nodes.find((node) => node.id === 'source');
  const audioPorts = sourceNode?.outputs.filter(isAudioPort) ?? [];
  const effectiveRefs = getEffectiveAudioRefs(clip);
  const hasAudio = clip.source?.type === 'audio'
    || clip.source?.type === 'video'
    || (clip.waveform?.length ?? 0) > 0
    || Boolean(clip.audioState?.sourceAnalysisRefs ?? clip.audioState?.processedAnalysisRefs);

  if (!hasAudio && audioPorts.length === 0) {
    return null;
  }

  return [
    'Audio source:',
    `- sourceType=${clip.source?.type ?? 'unknown'}`,
    `- sourceAudioRevision=${clip.audioState?.sourceAudioRevisionId ?? 'none'}`,
    `- clipMute=${clip.audioState?.muted === true}`,
    `- soloSafe=${clip.audioState?.soloSafe === true}`,
    `- waveformSamples=${clip.waveform?.length ?? 0}`,
    `- sourceAnalysisRefs=${formatAudioRefs(clip.audioState?.sourceAnalysisRefs)}`,
    `- processedAnalysisRefs=${formatAudioRefs(clip.audioState?.processedAnalysisRefs)}`,
    `- effectiveAnalysisRefs=${formatAudioRefs(effectiveRefs)}`,
    `- effectiveLoudnessSummary=${formatCachedLoudnessSummary(effectiveRefs?.loudnessEnvelopeId)}`,
    `- effectiveBeatGridSummary=${formatCachedBeatGridSummary(effectiveRefs?.beatGridId)}`,
    `- effectiveOnsetMapSummary=${formatCachedOnsetMapSummary(effectiveRefs?.onsetMapId)}`,
    `- effectiveFrequencySummary=${formatCachedFrequencySummary(effectiveRefs?.frequencySummaryId)}`,
    `- effectivePhaseCorrelationSummary=${formatCachedPhaseCorrelationSummary(effectiveRefs?.phaseCorrelationId)}`,
    `- effectiveRepairSuggestions=${formatAudioRepairSuggestions(effectiveRefs)}`,
    `- clipEditStack=${clip.audioState?.editStack?.length ?? 0}`,
    `- clipEffectStack=${formatAudioEffectStack(clip.audioState?.effectStack)}`,
    `- trackAudio=${track ? `id=${track.id} name="${track.name}" muted=${track.audioState?.muted ?? track.muted === true} solo=${track.audioState?.solo ?? track.solo === true} volumeDb=${track.audioState?.volumeDb ?? 0} pan=${track.audioState?.pan ?? 0} meter=${track.audioState?.meterMode ?? 'peak'} sends=${track.audioState?.sends?.length ?? 0}` : 'unknown'}`,
    `- trackEffectStack=${formatAudioEffectStack(track?.audioState?.effectStack)}`,
    `- masterAudio=${masterAudioState ? `volumeDb=${masterAudioState.volumeDb} limiter=${masterAudioState.limiterEnabled} truePeakCeilingDb=${masterAudioState.truePeakCeilingDb} targetLufs=${masterAudioState.targetLufs ?? 'none'}` : 'default'}`,
    `- masterEffectStack=${formatAudioEffectStack(masterAudioState?.effectStack)}`,
    '- graphPorts:',
    ...(audioPorts.length > 0
      ? audioPorts.map((port) => (
        `  - ${port.id}:${port.type} semantic=${port.metadata?.semanticKind ?? 'audio'} available=${port.metadata?.available !== false} stale=${port.metadata?.stale === true} provenance=${port.metadata?.artifactProvenance ?? 'none'} artifact=${port.metadata?.artifactId ?? 'none'} action=${port.metadata?.generateAction?.artifactKind ?? 'none'}`
      ))
      : ['  - none']),
  ].join('\n');
}

function buildTimelineContext(clip: TimelineClip, context?: AINodeAuthoringProjectContext): string {
  const clips = context?.clips ?? [clip];
  const tracks = context?.tracks ?? [];
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const visibleClips = clips
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, MAX_CONTEXT_CLIPS);

  return [
    `Tracks: ${tracks.map((track) => `${track.id}:${track.name}:${track.type}`).join(', ') || 'unknown'}`,
    'Timeline clips:',
    ...visibleClips.map((candidate) => formatClip(candidate, tracksById, clip.id)),
    clips.length > visibleClips.length ? `- ... ${clips.length - visibleClips.length} more clips omitted` : '',
  ].filter(Boolean).join('\n');
}

function buildGraphContext(graph: NodeGraph, definition: ClipCustomNodeDefinition): string {
  const selectedNode = graph.nodes.find((node) => node.id === definition.id);
  const nodes = graph.nodes.slice(0, MAX_CONTEXT_NODES);
  const edges = graph.edges.slice(0, MAX_CONTEXT_EDGES);
  const directEdges = getDirectEdges(graph, definition.id);

  return [
    'Current node:',
    selectedNode ? formatNode(selectedNode) : `- ${definition.id} (not projected)`,
    '',
    'Direct connections:',
    directEdges.length > 0 ? directEdges.map(formatEdge).join('\n') : '- none',
    '',
    'Graph nodes:',
    ...nodes.map(formatNode),
    graph.nodes.length > nodes.length ? `- ... ${graph.nodes.length - nodes.length} more nodes omitted` : '',
    '',
    'Graph edges:',
    edges.length > 0 ? edges.map(formatEdge).join('\n') : '- none',
    graph.edges.length > edges.length ? `- ... ${graph.edges.length - edges.length} more edges omitted` : '',
  ].filter(Boolean).join('\n');
}

export function buildAINodeAuthoringContext(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  context?: AINodeAuthoringProjectContext,
): string {
  const linkedContext = context
    ? resolveLinkedClipNodeGraphContext(context.clips ?? [clip], context.tracks ?? [], clip.id)
    : null;
  const graphClip = linkedContext ? createNodeGraphOwnerClip(linkedContext) : clip;
  const graph = buildClipNodeGraph(graphClip, linkedContext?.ownerTrack ?? undefined, {
    linkedClip: linkedContext?.linkedClip,
    linkedTrack: linkedContext?.linkedTrack,
  });
  const track = linkedContext?.ownerTrack ?? context?.tracks?.find(candidate => candidate.id === clip.trackId);
  const audioContextClip = linkedContext?.linkedClip?.source?.type === 'audio'
    ? linkedContext.linkedClip
    : graphClip;

  return [
    'MASTERSELECTS AI NODE AUTHORING CONTEXT',
    '',
    'Runtime capabilities:',
    '- custom node params support number, boolean, string, select, and color',
    '- color params use hex strings like "#008cff" at runtime and are keyframed internally through RGB channels',
    '',
    'Clip:',
    `- id=${graphClip.id}`,
    `- name="${graphClip.name}"`,
    `- source=${graphClip.source?.type ?? 'unknown'}`,
    `- file="${graphClip.file?.name ?? 'unknown'}"`,
    `- duration=${graphClip.duration}`,
    `- inPoint=${graphClip.inPoint}`,
    `- outPoint=${graphClip.outPoint}`,
    linkedContext?.linkedClip ? `- linkedClip=${linkedContext.linkedClip.id}:${linkedContext.linkedClip.source?.type ?? 'unknown'}` : '',
    '',
    buildTextSourceContext(graphClip),
    '',
    buildAudioSourceContext(audioContextClip, graph, track, context?.masterAudioState),
    '',
    buildTimelineContext(graphClip, context),
    '',
    buildGraphContext(graph, definition),
    '',
    'Authoring memory:',
    `- currentStatus=${definition.status}`,
    `- bypassed=${definition.bypassed === true}`,
    `- savedPlan=${definition.ai.plan?.trim() || 'none'}`,
    `- generatedCodePresent=${!!definition.ai.generatedCode?.trim()}`,
    `- exposedParams=${formatCustomParamSchema(definition)}`,
    `- conversationSummary=${definition.ai.conversationSummary?.trim() || 'none'}`,
  ].join('\n');
}
