import { EffectOrderControls } from './EffectOrderControls';
import { ControlNodeInspector } from './ControlNodeInspector';
import { TextNodeParameters } from './TextNodeParameters';
import { KeyframeNodeInspector } from '../keyframes/KeyframeNodeInspector';
import { NodeAnimationInspector } from '../keyframes/NodeAnimationInspector';
import { StabilizationNodeInspector } from './StabilizationNodeInspector';
import { describeNodePort, describePortText } from '../../../../services/nodeGraph/nodePortPresentation';
import { SceneOperatorParameters } from './SceneOperatorParameters';
import { OperatorGroupParameters } from './OperatorGroupParameters';
import { SceneNodeParameters } from './SceneNodeParameters';
import { FlockTab } from '../../properties/flock/FlockTab';
import { OperatorParameters, AddOperatorControl } from './OperatorParameters';
import { FaceCableControls } from '../../properties/FaceCableControls';
import { VoxelReliefControls } from '../../properties/VoxelReliefControls';
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { getCategoriesWithEffects } from '../../../../effects';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { GenerateClipAudioAnalysisOptions, TimelineClip } from '../../../../stores/timeline/types';
import type { NodeGraphNode, NodeGraphPort } from '../../../../services/nodeGraph';
import { CustomNodeParameters } from './CustomNodeParameters';
import {
  ColorNodeParameters,
  EffectNodeParameters,
  TransformNodeParameters,
} from './NodeWorkspaceParamEditors';
import { formatParamValue } from './nodeWorkspaceUtils';
import { FlockNodeInspector } from '../flock/FlockNodeInspector';
import type { FlockGraphActions } from '../flock/useFlockGraphActions';

type AudioAnalysisArtifactKind =
  | 'waveform-pyramid'
  | 'processed-waveform-pyramid'
  | 'spectrogram-tiles'
  | 'loudness-envelope'
  | 'beat-grid'
  | 'onset-map'
  | 'phase-correlation'
  | 'frequency-summary'
  | 'transcript-timing'
  | 'voice-activity'
  | 'speech-markers'
  | 'prosody-contour'
  | 'room-tone-profile';

const IMPLEMENTED_AUDIO_ANALYSIS_KINDS = new Set<string>([
  'waveform-pyramid',
  'processed-waveform-pyramid',
  'spectrogram-tiles',
  'loudness-envelope',
  'beat-grid',
  'onset-map',
  'phase-correlation',
  'frequency-summary',
  'transcript-timing',
  'voice-activity',
  'speech-markers',
  'prosody-contour',
  'room-tone-profile',
]);

const AI_SEED_AUDIO_PORT_KINDS = new Set([
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

function isImplementedAudioAnalysisKind(kind: string | undefined): kind is AudioAnalysisArtifactKind {
  return !!kind && IMPLEMENTED_AUDIO_ANALYSIS_KINDS.has(kind);
}

function canSeedAICustomNodeFromPort(port: NodeGraphPort): boolean {
  if (port.direction !== 'output') return false;
  if (port.metadata?.generateAction?.type === 'generate-audio-analysis') return true;
  const semanticKind = typeof port.metadata?.semanticKind === 'string' ? port.metadata.semanticKind : undefined;
  return semanticKind !== undefined && AI_SEED_AUDIO_PORT_KINDS.has(semanticKind);
}

function PortList({
  title,
  ports,
  clip,
  clips,
  nodeId,
  onGenerateAudioAnalysis,
  onCancelAudioAnalysis,
  onCreateAICustomNodeFromPort,
}: {
  title: string;
  ports: NodeGraphPort[];
  clip?: TimelineClip | null;
  clips?: TimelineClip[];
  nodeId?: string;
  onGenerateAudioAnalysis?: (clipId: string, kind: AudioAnalysisArtifactKind, options?: GenerateClipAudioAnalysisOptions) => void;
  onCancelAudioAnalysis?: (clipId: string) => void;
  onCreateAICustomNodeFromPort?: (source: { fromNodeId: string; fromPortId: string; label?: string }) => void;
}) {
  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">{title}</div>
      {ports.length > 0 ? (
        <div className="node-workspace-inspector-ports">
          {ports.map((port) => {
            const generateAction = port.metadata?.generateAction;
            const artifactKind = generateAction?.type === 'generate-audio-analysis'
              ? generateAction.artifactKind
              : undefined;
            const targetClipId = typeof port.metadata?.targetClipId === 'string'
              ? port.metadata.targetClipId
              : clip?.id;
            const targetClip = targetClipId
              ? clips?.find((candidate) => candidate.id === targetClipId) ?? clip
              : clip;
            const audioAnalysisBusy = targetClip?.audioAnalysisJob !== undefined || targetClip?.waveformGenerating === true;
            const canGenerate = !!targetClip
              && !!artifactKind
              && isImplementedAudioAnalysisKind(artifactKind)
              && !audioAnalysisBusy;
            const canCancel = !!targetClip && !!artifactKind && audioAnalysisBusy;
            const available = port.metadata?.available !== false;
            const canCreateAI = !!clip && !!nodeId && canSeedAICustomNodeFromPort(port);

            return (
              <div key={port.id} className="node-workspace-inspector-port" title={describePortText(port)}>
                <span className="node-workspace-inspector-port-main">
                  <span>{port.label}</span>
                  {port.metadata?.artifactId && (
                    <span className="node-workspace-inspector-port-artifact">{port.metadata.artifactId}</span>
                  )}
                </span>
                <span className="node-workspace-inspector-port-side">
                  <span>{describeNodePort(port).typeLabel}</span>
                  {artifactKind && (
                    <button
                      type="button"
                      className="node-workspace-port-action"
                      disabled={!canGenerate && !canCancel}
                      onClick={() => {
                        if (!targetClip) return;
                        if (audioAnalysisBusy) {
                          onCancelAudioAnalysis?.(targetClip.id);
                        } else if (isImplementedAudioAnalysisKind(artifactKind)) {
                          onGenerateAudioAnalysis?.(targetClip.id, artifactKind, { force: available });
                        }
                      }}
                    >
                      {audioAnalysisBusy ? 'Cancel' : available ? 'Refresh' : 'Generate'}
                    </button>
                  )}
                  {canCreateAI && (
                    <button
                      type="button"
                      className="node-workspace-port-action ai"
                      onClick={() => {
                        if (!nodeId) return;
                        onCreateAICustomNodeFromPort?.({
                          fromNodeId: nodeId,
                          fromPortId: port.id,
                          label: `${port.label} AI`,
                        });
                      }}
                    >
                      AI
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="node-workspace-inspector-empty">None</div>
      )}
    </div>
  );
}

function NodeInspectorShell({
  ai = false,
  children,
  width,
  onStartResize,
}: {
  ai?: boolean;
  children: ReactNode;
  width: number;
  onStartResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <aside
      className={`node-workspace-inspector${ai ? ' node-workspace-inspector-ai' : ''}`}
      style={{ width, minWidth: width, maxWidth: 'none' }}
    >
      <div
        className="node-workspace-inspector-resize-handle"
        role="separator"
        aria-orientation="vertical"
        title="Resize inspector"
        onMouseDown={onStartResize}
      />
      {children}
    </aside>
  );
}

export function NodeInspector({
  node,
  clip,
  inspectorWidth,
  onSelectNode,
  onOpenProperties,
  onStartResizeInspector,
  showClipActions = true,
  showAnimation = false,
  onShowParameters,
  flockActions,
}: {
  node: NodeGraphNode | null;
  clip: TimelineClip | null;
  inspectorWidth: number;
  onSelectNode: (nodeId: string) => void;
  onOpenProperties: () => void;
  onStartResizeInspector: (event: ReactMouseEvent<HTMLDivElement>) => void;
  showClipActions?: boolean;
  showAnimation?: boolean;
  onShowParameters?: () => void;
  /** Present in the Flock view: flock nodes edit the clip's canonical FlockDefinition. */
  flockActions?: FlockGraphActions;
}) {
  const params = Object.entries(node?.params ?? {});
  const canEditTransform = !!clip && node?.id === 'transform';
  const canEditEffect = !!clip && node?.id.startsWith('effect-');
  const canEditColor = !!clip && node?.binding?.kind === 'color-node';
  const canEditCustom = !!clip && node?.binding?.kind === 'clip-custom-node';
  const generateWaveformForClip = useTimelineStore((state) => state.generateWaveformForClip);
  const generateProcessedWaveformForClip = useTimelineStore((state) => state.generateProcessedWaveformForClip);
  const generateSpectrogramForClip = useTimelineStore((state) => state.generateSpectrogramForClip);
  const generateLoudnessForClip = useTimelineStore((state) => state.generateLoudnessForClip);
  const generateBeatOnsetForClip = useTimelineStore((state) => state.generateBeatOnsetForClip);
  const generateFrequencyPhaseForClip = useTimelineStore((state) => state.generateFrequencyPhaseForClip);
  const cancelAudioAnalysisForClip = useTimelineStore((state) => state.cancelAudioAnalysisForClip);
  const addClipAICustomNodeFromPort = useTimelineStore((state) => state.addClipAICustomNodeFromPort);
  const clips = useTimelineStore((state) => state.clips);
  const nodeTargetClipId = typeof node?.params?.targetClipId === 'string'
    ? node.params.targetClipId
    : clip?.id;
  const nodeTargetClip = nodeTargetClipId
    ? clips.find((candidate) => candidate.id === nodeTargetClipId) ?? clip
    : clip;
  const generateAudioAnalysis = useCallback((
    clipId: string,
    kind: AudioAnalysisArtifactKind,
    options?: GenerateClipAudioAnalysisOptions,
  ) => {
    if (kind === 'processed-waveform-pyramid') {
      void generateProcessedWaveformForClip(clipId, options);
    } else if (kind === 'waveform-pyramid') {
      void generateWaveformForClip(clipId, options);
    } else if (kind === 'spectrogram-tiles') {
      void generateSpectrogramForClip(clipId, options);
    } else if (kind === 'loudness-envelope') {
      void generateLoudnessForClip(clipId, options);
    } else if (kind === 'beat-grid' || kind === 'onset-map') {
      void generateBeatOnsetForClip(clipId, options);
    } else if (kind === 'phase-correlation' || kind === 'frequency-summary') {
      void generateFrequencyPhaseForClip(clipId, options);
    }
  }, [
    generateBeatOnsetForClip,
    generateFrequencyPhaseForClip,
    generateLoudnessForClip,
    generateProcessedWaveformForClip,
    generateSpectrogramForClip,
    generateWaveformForClip,
  ]);
  const createAICustomNodeFromPort = useCallback((source: { fromNodeId: string; fromPortId: string; label?: string }) => {
    if (!clip) return;
    startBatch('Add AI node from audio port');
    try {
      const nodeId = addClipAICustomNodeFromPort(clip.id, source);
      if (nodeId) onSelectNode(nodeId);
    } finally {
      endBatch();
    }
  }, [addClipAICustomNodeFromPort, clip, onSelectNode]);

  if (!node) {
    return (
      <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
        <div className="node-workspace-inspector-empty">Select a node</div>
      </NodeInspectorShell>
    );
  }

  if (clip && showAnimation && node.animation?.channels.length) {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <NodeAnimationInspector key={node.id} clip={clip} node={node} onShowParameters={onShowParameters} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'scene-node') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}><SceneNodeParameters node={node} owner={clip} /></NodeInspectorShell>;
  }
  if (clip?.textProperties && (node.binding?.kind === 'clip-text' || node.binding?.kind === 'clip-source' && clip.source?.type === 'text')) {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <TextNodeParameters key={`${clip.id}:${node.id}`} clip={clip} stage={node.binding.kind === 'clip-text' ? node.binding.stage : 'content'} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'clip-stabilization') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <StabilizationNodeInspector key={`${clip.id}:${node.id}:${clip.nodeGraph?.stabilization?.bake?.bakedAt ?? ''}`}
        clip={clip} node={node} onOpenProperties={onOpenProperties} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'keyframe-node') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <KeyframeNodeInspector key={node.id} clip={clip} nodeId={node.binding.nodeId} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'parameter-source') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <ControlNodeInspector key={node.id} clip={clip} nodeId={node.binding.nodeId} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'scene-operator') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <SceneOperatorParameters clip={clip} nodeId={node.binding.nodeId} onAdded={id => onSelectNode(`${node.id.slice(0, node.id.lastIndexOf('/') + 1)}${id}`)} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'operator-group') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <OperatorGroupParameters clip={clip} groupId={node.binding.groupId} effectId={node.binding.effectId} />
    </NodeInspectorShell>;
  }
  if (clip && node.binding?.kind === 'effect-operator') {
    const binding = node.binding;
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <EffectOrderControls clip={clip} effectId={binding.effectId} />
      <OperatorParameters clip={nodeTargetClip ?? clip} effectId={binding.effectId} nodeId={binding.nodeId} projectedNode={node} />
      {['simulation.rope', 'tracking.anchors', 'render.cables'].includes(binding.operator) && <FaceCableControls clipId={clip.id} effectId={binding.effectId} scope={binding.operator === 'tracking.anchors' ? 'anchors' : binding.operator === 'render.cables' ? 'render' : 'simulation'} />}
      <AddOperatorControl clipId={nodeTargetClipId ?? clip.id} effectId={binding.effectId} onAdded={id => onSelectNode(`${node.id.slice(0, node.id.lastIndexOf('/') + 1)}${id}`)} />
    </NodeInspectorShell>;
  }
  if (clip?.flock && (node.binding?.kind === 'clip-source' || node.binding?.kind === 'clip-effect') && node.groupId === 'flock') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}><FlockTab clipId={clip.id} /></NodeInspectorShell>;
  }
  const faceEffectId = node.binding?.kind === 'clip-effect' ? node.binding.effectId : undefined;
  if (clip && faceEffectId && clip.effects.find(e => e.id === faceEffectId)?.type === 'voxel-relief') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <EffectOrderControls clip={clip} effectId={faceEffectId} />
      <VoxelReliefControls clipId={clip.id} effectId={faceEffectId} />
    </NodeInspectorShell>;
  }
  if (clip && faceEffectId && clip.effects.find(e => e.id === faceEffectId)?.type === 'face-cables') {
    return <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      <EffectOrderControls clip={clip} effectId={faceEffectId} />
      <FaceCableControls clipId={clip.id} effectId={faceEffectId} />
    </NodeInspectorShell>;
  }
  if (clip && flockActions && node.binding?.kind === 'flock-node') {
    return (
      <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
        <FlockNodeInspector clip={clip} node={{ ...node, id: node.binding.nodeId }} actions={flockActions} onSelectNode={id => onSelectNode(`${node.id.slice(0, node.id.lastIndexOf('/') + 1)}${id}`)} />
        <button type="button" className="node-workspace-primary-action" onClick={onOpenProperties}>
          Open Properties
        </button>
      </NodeInspectorShell>
    );
  }

  if (canEditCustom) {
    return (
      <NodeInspectorShell ai width={inspectorWidth} onStartResize={onStartResizeInspector}>
        <CustomNodeParameters clip={clip} node={node} />
      </NodeInspectorShell>
    );
  }

  return (
    <NodeInspectorShell width={inspectorWidth} onStartResize={onStartResizeInspector}>
      {clip && node.binding?.kind === 'clip-effect' && <EffectOrderControls clip={clip} effectId={node.binding.effectId} />}
      <div className="node-workspace-inspector-header">
        <span>{typeof node.params?.categoryLabel === 'string' ? node.params.categoryLabel : node.kind}</span>
        <h3>{node.label}</h3>
        <p>{node.description}</p>
      </div>

      <div className="node-workspace-inspector-meta">
        <div>
          <span>Runtime</span>
          <strong>{node.runtime}</strong>
        </div>
        {node.sourceType && (
          <div>
            <span>Source</span>
            <strong>{node.sourceType}</strong>
          </div>
        )}
      </div>

      <PortList
        title="Inputs"
        ports={node.inputs}
        clip={clip}
        clips={clips}
        nodeId={node.id}
        onGenerateAudioAnalysis={generateAudioAnalysis}
        onCancelAudioAnalysis={cancelAudioAnalysisForClip}
        onCreateAICustomNodeFromPort={createAICustomNodeFromPort}
      />
      <PortList
        title="Outputs"
        ports={node.outputs}
        clip={clip}
        clips={clips}
        nodeId={node.id}
        onGenerateAudioAnalysis={generateAudioAnalysis}
        onCancelAudioAnalysis={cancelAudioAnalysisForClip}
        onCreateAICustomNodeFromPort={createAICustomNodeFromPort}
      />

      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Parameters</div>
        {canEditTransform ? (
          <TransformNodeParameters clip={clip} />
        ) : canEditEffect && nodeTargetClip ? (
          <EffectNodeParameters clip={nodeTargetClip} node={node} />
        ) : canEditColor ? (
          <ColorNodeParameters clip={clip} node={{ ...node, id: node.binding?.kind === 'color-node' ? node.binding.nodeId : node.id }} />
        ) : params.length > 0 ? (
          <div className="node-workspace-param-list">
            {params.map(([key, value]) => (
              <div key={key} className="node-workspace-param">
                <span>{key}</span>
                <strong>{formatParamValue(value)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="node-workspace-inspector-empty">None</div>
        )}
      </div>

      {clip && showClipActions && <ClipNodeActions clip={clip} onSelectNode={onSelectNode} />}

      <button type="button" className="node-workspace-primary-action" onClick={onOpenProperties}>
        Open Properties
      </button>
    </NodeInspectorShell>
  );
}

function ClipNodeActions({ clip, onSelectNode }: { clip: TimelineClip; onSelectNode: (nodeId: string) => void }) {
  const addClipEffect = useTimelineStore((state) => state.addClipEffect);
  const addClipAICustomNode = useTimelineStore((state) => state.addClipAICustomNode);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);

  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">Add Node</div>
      <button
        type="button"
        className="node-workspace-secondary-action"
        onClick={() => {
          startBatch('Add AI node');
          try {
            const nodeId = addClipAICustomNode(clip.id);
            if (nodeId) onSelectNode(nodeId);
          } finally {
            endBatch();
          }
        }}
      >
        AI Node
      </button>
      <select
        className="node-workspace-add-node-select"
        defaultValue=""
        onChange={(event) => {
          const effectType = event.target.value;
          if (!effectType) return;
          startBatch('Add effect node');
          try {
            const effectId = addClipEffect(clip.id, effectType);
            onSelectNode(`effect-${effectId}`);
          } finally {
            endBatch();
          }
          event.target.value = '';
        }}
      >
        <option value="" disabled>Effect...</option>
        {effectCategories.map(({ category, effects }) => (
          <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
            {effects.map((effect) => (
              <option key={effect.id} value={effect.id}>{effect.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
