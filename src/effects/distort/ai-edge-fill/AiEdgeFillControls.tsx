import { useSyncExternalStore } from 'react';
import type { EffectControlProps } from '../../types';
import { InspectorSelect } from '../../../components/inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../../components/panels/properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../../components/panels/properties/resolveInspector/ResolveInspectorNumberRow';
import { EffectKeyframeToggle } from '../../../components/panels/properties/shared';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { discardEdgeFill, edgeFillJob, generateEdgeFill, subscribeEdgeFillJobs } from './edgeFillGeneration';
import { edgeFillFraming, edgeFillSource } from './edgeFillSource';
import { EDGE_FILL_PROMPT, LEGACY_EDGE_FILL_PROMPT } from './edgeFillPrompt';
import { edgeFillArtifacts } from './edgeFillArtifacts';
import '../../../components/panels/properties/perspectiveGuides/PerspectiveGuides.css';
import './AiEdgeFillControls.css';

export default function AiEdgeFillControls({ params, onChange, clipId = '', effectInstanceId = '' }: EffectControlProps) {
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const composition = useMediaStore(state => state.compositions.find(item => item.id === state.activeCompositionId));
  const job = useSyncExternalStore(subscribeEdgeFillJobs, () => edgeFillJob(clipId, effectInstanceId));
  useSyncExternalStore(edgeFillArtifacts.subscribe, edgeFillArtifacts.getRevision);
  let sourceError = '', outdated = false;
  try {
    if (!clip?.file || clip.source?.type !== 'image') throw new Error('Still images only, including CR2.');
    if (!composition) throw new Error('Open the still-image composition first.');
    const source = edgeFillSource(clip.file, clip.effects, effectInstanceId, edgeFillFraming(clip.transform, composition));
    outdated = !!params.artifactId && params.sourceSignature !== source.signature;
  } catch (error) { sourceError = error instanceof Error ? error.message : String(error); }
  const artifactId = String(params.artifactId || '');
  const artifactError = edgeFillArtifacts.error(artifactId);
  const pending = !!params.taskId || !!params.requestId || !!job.taskId;
  const prompt = params.prompt === LEGACY_EDGE_FILL_PROMPT ? EDGE_FILL_PROMPT : String(params.prompt || EDGE_FILL_PROMPT);
  return <ResolveInspectorSection title="AI edge fill" indicator="none">
    <ResolveInspectorRow label="Model"><span className="effect-info">Nano Banana Pro · Kie.ai cloud</span></ResolveInspectorRow>
    <ResolveInspectorRow label="Generation size"><InspectorSelect ariaLabel="AI fill generation size"
      disabled={job.busy || pending} value={String(params.resolution || '2K')}
      options={['1K', '2K', '4K'].map(value => ({ value, label: value }))}
      onChange={resolution => onChange({ ...params, resolution })} /></ResolveInspectorRow>
    <ResolveInspectorRow label="Prompt"><textarea className="ai-edge-fill-prompt" aria-label="AI fill prompt"
      rows={8} value={prompt} disabled={job.busy || pending}
      onKeyDown={event => event.stopPropagation()} onChange={event => onChange({ ...params, prompt: event.target.value })} /></ResolveInspectorRow>
    <ResolveInspectorRow label="Fill"><button type="button" className="perspective-action"
      disabled={job.busy || !!sourceError || !clipId || !effectInstanceId}
      onPointerUp={event => event.currentTarget.blur()} onClick={() => { void generateEdgeFill(clipId, effectInstanceId); }}>
      {job.busy ? 'Generating…' : pending ? 'Resume task' : artifactId ? 'Regenerate fill' : 'Generate fill'}
    </button></ResolveInspectorRow>
    <p className="effect-info">Uploads the positioned, corrected photo and a white=missing mask to Kie.ai. Uses cloud credits. Fills transparent areas across the full composition.
      {' '}The saved fill is scaled to your output resolution. Change the prompt for scenes other than interiors.</p>
    <ResolveInspectorNumberRow label="Fill Opacity" value={Number(params.mix ?? 100)} defaultValue={100}
      min={0} max={100} hardMin={0} hardMax={100} step={.1} suffix="%"
      onChange={mix => onChange({ ...params, mix })}
      keyframeToggle={clipId && effectInstanceId ? <EffectKeyframeToggle clipId={clipId} effectId={effectInstanceId} paramName="mix" value={Number(params.mix ?? 100)} /> : undefined} />
    <ResolveInspectorNumberRow label="Seam Blend" value={Number(params.seamBlend ?? 12)} defaultValue={12}
      min={0} max={64} hardMin={0} hardMax={64} step={1} suffix="px"
      onChange={seamBlend => onChange({ ...params, seamBlend })}
      keyframeToggle={clipId && effectInstanceId ? <EffectKeyframeToggle clipId={clipId} effectId={effectInstanceId} paramName="seamBlend" value={Number(params.seamBlend ?? 12)} /> : undefined} />
    {(sourceError || outdated || job.error || artifactError || job.message) && <p className="effect-info" role="status" aria-live="polite">
      {sourceError || job.error || artifactError || (outdated ? 'Correction changed. Regenerate the fill to match it.' : job.message)}
    </p>}
    {artifactError && <ResolveInspectorRow label="Saved fill"><button type="button" className="perspective-action"
      onPointerUp={event => event.currentTarget.blur()} onClick={() => edgeFillArtifacts.retry(artifactId)}>Retry loading</button></ResolveInspectorRow>}
    {(artifactId || pending) && <ResolveInspectorRow label="Reset"><button type="button" className="perspective-action" disabled={job.busy}
      onPointerUp={event => event.currentTarget.blur()} onClick={() => { void discardEdgeFill(clipId, effectInstanceId); }}>
      {pending ? 'Discard pending task' : 'Clear fill'}</button></ResolveInspectorRow>}
  </ResolveInspectorSection>;
}
