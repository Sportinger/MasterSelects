import { cloudAiService } from '../../../services/cloudAiService';
import { createGuidedPhotoPreview } from '../../../services/rawImage/guidedPhotoPreview';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { artifactService } from '../../../services/project/domains/ArtifactService';
import { projectFileService } from '../../../services/project/ProjectFileService';
import { captureRepositoryDomainPublication } from '../../../services/project/repository/artifacts/RepositoryDomainPublication';
import { edgeFillFraming, edgeFillHasAnimation, edgeFillSource } from './edgeFillSource';
import { edgeFillArtifacts } from './edgeFillArtifacts';
import { useMediaStore } from '../../../stores/mediaStore';
import { canvasPlacement } from './canvasPlacement';
import { edgeFillReference } from './edgeFillReference';
import { getEffectiveScale } from '../../../utils/transformScale';
import { rotationDegreesToRadians } from '../../../utils/rotationUnits';
import { EDGE_FILL_PROMPT, LEGACY_EDGE_FILL_PROMPT } from './edgeFillPrompt';

interface JobState { busy: boolean; message: string; error?: string; taskId?: string }
const IDLE: JobState = { busy: false, message: '' };
interface Jobs { states: Map<string, JobState>; listeners: Set<() => void> }
const jobs: Jobs = import.meta.hot?.data?.edgeFillJobs ?? { states: new Map(), listeners: new Set() };
if (import.meta.hot) import.meta.hot.dispose(data => { data.edgeFillJobs = jobs; });
const key = (clipId: string, effectId: string) => JSON.stringify([clipId, effectId]);
export function edgeFillJob(clipId: string, effectId: string): JobState { return jobs.states.get(key(clipId, effectId)) ?? IDLE; }
export function subscribeEdgeFillJobs(listener: () => void): () => void {
  jobs.listeners.add(listener); return () => { jobs.listeners.delete(listener); };
}
const checkpointId = (clipId: string, effectId: string) => `ai-edge-fill:${clipId}:${effectId}`;
export async function discardEdgeFill(clipId: string, effectId: string): Promise<void> {
  if (edgeFillJob(clipId, effectId).busy) return;
  useTimelineStore.getState().updateClipEffect(clipId, effectId, { artifactId: '', canvasSpace: false, sourceSignature: '', taskId: '', taskSignature: '', requestId: '', requestSignature: '' });
  update(clipId, effectId, IDLE);
  await captureRepositoryDomainPublication()?.appendJournal(checkpointId(clipId, effectId), { taskId: '' });
}
function update(clipId: string, effectId: string, state: JobState): void {
  jobs.states.set(key(clipId, effectId), state);
  if (jobs.states.size > 32) {
    for (const [id, job] of jobs.states) { if (!job.busy && id !== key(clipId, effectId)) { jobs.states.delete(id); break; } }
  }
  jobs.listeners.forEach(listener => listener());
}
/** A deliberate UI action; render frames never initiate provider calls. Pending task IDs support retry without charging again. */
export async function generateEdgeFill(clipId: string, effectId: string): Promise<void> {
  if (edgeFillJob(clipId, effectId).busy) return;
  update(clipId, effectId, { busy: true, message: 'Preparing corrected photo…' });
  try {
    const initial = useTimelineStore.getState().clips.find(clip => clip.id === clipId);
    const effect = initial?.effects.find(item => item.id === effectId);
    if (!initial?.file || initial.source?.type !== 'image' || !effect) throw new Error('AI Edge Fill currently supports still images, including CR2.');
    const media = useMediaStore.getState();
    const composition = media.compositions.find(item => item.id === media.activeCompositionId);
    if (!composition) throw new Error('Open the still-image composition first.');
    if (initial.masks?.length || initial.colorCorrection?.enabled || composition.camera?.enabled) throw new Error('Generate canvas fill before masks/color grading and with the 3D camera disabled.');
    const source = edgeFillSource(initial.file, initial.effects, effectId, edgeFillFraming(initial.transform, composition));
    if (edgeFillHasAnimation(useTimelineStore.getState().clipKeyframes.get(clipId) ?? [], source.effects, initial.transform)) {
      throw new Error('Use static lens/perspective settings for a still-image fill; animated geometry is not supported.');
    }
    const publication = captureRepositoryDomainPublication();
    const handle = projectFileService.getProjectHandle();
    const store = publication?.artifacts ?? (handle ? artifactService.createStore(handle) : artifactService.createIndexedDBStore());
    const current = () => {
      const active = captureRepositoryDomainPublication();
      if (active?.repositoryId !== publication?.repositoryId || active?.sessionEpoch !== publication?.sessionEpoch
        || projectFileService.getProjectHandle() !== handle) throw new Error('Project changed. Return to the original project to resume the saved task.');
      const clip = useTimelineStore.getState().clips.find(item => item.id === clipId);
      const latest = clip?.effects.find(item => item.id === effectId);
      if (!clip || !latest || clip.file !== initial.file) throw new Error('Source or effect changed. The generated image was not applied.');
      const latestComposition = useMediaStore.getState().compositions.find(item => item.id === useMediaStore.getState().activeCompositionId);
      if (!latestComposition || edgeFillSource(clip.file, clip.effects, effectId, edgeFillFraming(clip.transform, latestComposition)).signature !== source.signature) throw new Error('Correction or photo placement changed. Restore its settings to resume this task, or discard the task and regenerate.');
      if (edgeFillHasAnimation(useTimelineStore.getState().clipKeyframes.get(clipId) ?? [], source.effects, clip.transform)) throw new Error('Geometry animation changed while generating. The image was not applied.');
      return latest;
    };
    const checkpoint = await publication?.readJournal(checkpointId(clipId, effectId)) as { taskId?: string; requestId?: string; signature?: string; aspect?: number } | null;
    let taskId = String(effect.params.taskId || checkpoint?.taskId || '');
    let aspect = checkpoint?.aspect;
    const pendingSignature = effect.params.taskId ? effect.params.taskSignature : checkpoint?.signature;
    if (taskId) update(clipId, effectId, { busy: true, message: 'Resuming saved task…', taskId });
    if (taskId && pendingSignature !== source.signature) throw new Error('Pending task uses different corrections. Restore them or discard the task before generating again.');
    if (!taskId) {
      const enteredPrompt = String(effect.params.prompt || '').trim();
      const prompt = enteredPrompt === LEGACY_EDGE_FILL_PROMPT ? EDGE_FILL_PROMPT : enteredPrompt;
      if (!prompt) throw new Error('Enter a prompt describing how to extend the photograph.');
      const requestId = String(effect.params.requestId || checkpoint?.requestId || `edge-fill:${crypto.randomUUID()}`);
      const requestSignature = effect.params.requestId ? effect.params.requestSignature : checkpoint?.requestId ? checkpoint.signature : source.signature;
      if (requestSignature !== source.signature) throw new Error('Pending request uses different corrections. Restore them or discard it first.');
      const preview = await createGuidedPhotoPreview(initial.file, source.effects);
      aspect = composition.width / composition.height;
      const placement = canvasPlacement({ ...initial.transform, scale: getEffectiveScale(initial.transform.scale),
        rotation: rotationDegreesToRadians(initial.transform.rotation) }, preview.sourceWidth, preview.sourceHeight, composition.width, composition.height);
      const images = await edgeFillReference(preview.blob, placement, aspect);
      current();
      await publication?.appendJournal(checkpointId(clipId, effectId), { requestId, signature: source.signature, aspect });
      current();
      useTimelineStore.getState().updateClipEffect(clipId, effectId, { requestId, requestSignature: source.signature });
      taskId = await cloudAiService.createTextToImage({ provider: 'nano-banana-pro', prompt,
        resolution: ['1K', '2K', '4K'].includes(String(effect.params.resolution)) ? String(effect.params.resolution) : '2K',
        aspectRatio: 'auto', outputFormat: 'png', imageInputs: images }, requestId);
      // Record against the captured original repository even if the user switches projects while the provider starts.
      await publication?.appendJournal(checkpointId(clipId, effectId), { taskId, signature: source.signature, aspect });
      update(clipId, effectId, { busy: true, message: 'Task started…', taskId });
      current();
      useTimelineStore.getState().updateClipEffect(clipId, effectId, { taskId, taskSignature: source.signature, requestId: '', requestSignature: '' });
    }
    update(clipId, effectId, { busy: true, message: 'Generating with Kie.ai / Nano Banana Pro…', taskId });
    const task = await cloudAiService.pollTaskUntilComplete(taskId, progress => {
      update(clipId, effectId, { busy: true, message: `Generating… ${Math.round((progress.progress ?? 0) * 100)}%`, taskId });
    }, 5000);
    if (task.status !== 'completed') {
      current(); useTimelineStore.getState().updateClipEffect(clipId, effectId, { taskId: '', taskSignature: '' });
      await publication?.appendJournal(checkpointId(clipId, effectId), { taskId: '' });
      update(clipId, effectId, IDLE);
      throw new Error(task.error || 'Image generation failed.');
    }
    current();
    const url = task.imageUrl ?? task.videoUrl;
    if (!url) throw new Error('Provider returned no fill image. Resume to retry downloading.');
    update(clipId, effectId, { busy: true, message: 'Saving fill image…', taskId });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fill download failed (${response.status}). Resume to retry.`);
    const artifactId = await edgeFillArtifacts.save(await response.blob(), store, source.signature, aspect);
    current();
    startBatch('Generate AI edge fill');
    try { useTimelineStore.getState().updateClipEffect(clipId, effectId, {
      artifactId, canvasSpace: true, sourceSignature: source.signature, taskId: '', taskSignature: '', requestId: '', requestSignature: '',
    }); } finally { endBatch(); }
    await publication?.appendJournal(checkpointId(clipId, effectId), { taskId: '' });
    update(clipId, effectId, { busy: false, message: 'Fill saved. Original pixels preserved.' });
  } catch (error) {
    update(clipId, effectId, { busy: false, message: '', taskId: edgeFillJob(clipId, effectId).taskId,
      error: error instanceof Error ? error.message : String(error) });
  }
}
