import { useState } from 'react';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { useDocumentsStore } from '../../../stores/documentsStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { documentLinkExists } from '../../../services/documents/linkStatus';
import { DOCUMENT_MEDIA_REFERENCE_MIME, resolveDocumentMediaDrag } from '../../../services/documents/documentMediaDrag';
import { clearExternalDragPayload, createExternalDragPayloadForProjectItem,
  setExternalDragPayload } from '../../timeline/utils/externalDragSession';
import { ResolveInspectorRow, ResolveInspectorSection } from '../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import type { DocumentAnchor, DocumentLinkTarget, NotebookScene, ProjectDocument } from '../../../types/documents';

interface NotebookDetailsProps {
  document: ProjectDocument;
  captureSelection: () => DocumentAnchor | null;
  changeSceneRange: (id: string) => void;
  continueOutsideScene: (id: string) => void;
  notice: (value: string) => void;
}

export function NotebookDetails({ document, captureSelection, changeSceneRange,
  continueOutsideScene, notice }: NotebookDetailsProps) {
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const media = useMediaStore(state => state.files);
  const compositions = useMediaStore(state => state.compositions);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const clips = useTimelineStore(state => state.clips);
  const requestSourceSeek = useAnnotationStore(state => state.requestSourceSeek);
  const changeScene = (sceneId: string, changes: Partial<Pick<NotebookScene,
    'anchor' | 'name' | 'location' | 'interiorExterior' | 'timeOfDay' | 'labels' | 'mediaIds'>>) => {
    useDocumentsStore.getState().updateScene(document.id, sceneId, changes);
  };
  const navigateLink = async (target: DocumentLinkTarget) => {
    const mediaState = useMediaStore.getState();
    if (target.kind === 'source' || target.kind === 'source-annotation') {
      mediaState.setSourceMonitorFile(target.mediaId);
      if (target.kind === 'source' && target.start !== undefined) requestSourceSeek(target.mediaId, target.start);
      if (target.kind === 'source-annotation') {
        const annotation = mediaState.files.find(file => file.id === target.mediaId)?.sourceAnnotations
          ?.find(item => item.id === target.annotationId);
        if (annotation) requestSourceSeek(target.mediaId, annotation.startTime);
      }
      return;
    }
    await mediaState.openCompositionTab(target.compositionId);
    const timeline = useTimelineStore.getState();
    if (target.kind === 'clip') {
      const clip = timeline.clips.find(item => item.id === target.clipId);
      if (clip) { timeline.selectClips([clip.id]); timeline.setPlayheadPosition(clip.startTime + (target.start ?? 0)); }
    } else if (target.kind === 'composition') timeline.setPlayheadPosition(target.start);
    else {
      const annotation = useMediaStore.getState().compositions
        .find(item => item.id === target.compositionId)?.annotations?.find(item => item.id === target.annotationId);
      if (annotation) timeline.setPlayheadPosition(annotation.startTime);
    }
  };
  const hasDetails = Boolean(document.labels?.length || document.scenes?.length
    || document.links.length || document.comments.length);
  if (!hasDetails) return null;
  return <aside className="notebook-details" aria-label="Notebook annotations">
    {document.scenes?.map(scene => <div key={scene.id} className="notebook-scene-detail">
      <button type="button" className="notebook-detail" aria-expanded={selectedSceneId === scene.id}
        onClick={() => setSelectedSceneId(selectedSceneId === scene.id ? null : scene.id)}>
        Scene · {scene.name || scene.anchor.quote.slice(0, 48) || 'Empty scene'}
      </button>
      {selectedSceneId === scene.id && <ResolveInspectorSection title="Scene properties" indicator="none">
        <ResolveInspectorRow label="Name"><input aria-label="Scene name" value={scene.name ?? ''}
          onFocus={() => startBatch('Edit Notebook scene')} onBlur={() => endBatch()}
          onChange={event => changeScene(scene.id, { name: event.target.value })} /></ResolveInspectorRow>
        <ResolveInspectorRow label="Location"><input aria-label="Scene location" value={scene.location ?? ''}
          onFocus={() => startBatch('Edit Notebook scene')} onBlur={() => endBatch()}
          onChange={event => changeScene(scene.id, { location: event.target.value })} /></ResolveInspectorRow>
        <ResolveInspectorRow label="Setting"><InspectorSelect ariaLabel="Interior or exterior"
          value={scene.interiorExterior ?? ''} onChange={value => changeScene(scene.id,
            { interiorExterior: value || undefined })}
          options={[{ value: '', label: 'Unspecified' }, { value: 'interior', label: 'Interior' },
            { value: 'exterior', label: 'Exterior' }]} /></ResolveInspectorRow>
        <ResolveInspectorRow label="Time"><input aria-label="Scene time of day" value={scene.timeOfDay ?? ''}
          onFocus={() => startBatch('Edit Notebook scene')} onBlur={() => endBatch()}
          onChange={event => changeScene(scene.id, { timeOfDay: event.target.value })} /></ResolveInspectorRow>
        <ResolveInspectorRow label="Labels"><input aria-label="Scene labels" key={`${scene.id}-labels`}
          defaultValue={scene.labels?.join(', ') ?? ''} placeholder="Optional, comma separated"
          onBlur={event => {
            const labels = event.target.value.split(',').map(item => item.trim()).filter(Boolean);
            const batch = startBatch('Edit Notebook scene labels');
            changeScene(scene.id, { labels });
            if (batch.opened) endBatch();
          }} /></ResolveInspectorRow>
        <ResolveInspectorRow label="Media"><div className="notebook-scene-media">
          <select aria-label="Link scene media" value="" onChange={event => {
            const batch = startBatch('Link media to Notebook scene');
            changeScene(scene.id, { mediaIds: [...new Set([...(scene.mediaIds ?? []), event.target.value])] });
            if (batch.opened) endBatch();
          }}>
            <option value="">Choose media…</option>
            {media.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {scene.mediaIds?.map(mediaId => <span key={mediaId}>
            {media.find(item => item.id === mediaId)?.name ?? 'Missing media'}
            <button type="button" aria-label="Unlink scene media" onClick={() => {
              const batch = startBatch('Unlink Notebook scene media');
              changeScene(scene.id, { mediaIds: scene.mediaIds?.filter(id => id !== mediaId) });
              if (batch.opened) endBatch();
            }}>×</button>
          </span>)}
        </div></ResolveInspectorRow>
        <div className="notebook-scene-actions">
          <button type="button" onClick={() => changeSceneRange(scene.id)}>Change range to selection</button>
          <button type="button" onClick={() => continueOutsideScene(scene.id)}>Continue outside scene</button>
          <button type="button" onClick={() => {
            const batch = startBatch('Remove Notebook scene');
            useDocumentsStore.getState().removeScene(document.id, scene.id);
            if (batch.opened) endBatch();
            setSelectedSceneId(null);
          }}>Remove scene</button>
        </div>
      </ResolveInspectorSection>}
    </div>)}
    {document.labels?.map(label => <div key={label.id} className="notebook-detail">
      <input aria-label="Label name" value={label.name}
        onFocus={() => startBatch('Edit Notebook label')} onBlur={() => endBatch()}
        onChange={event => useDocumentsStore.getState().updateLabel(document.id, label.id,
          { name: event.target.value })} />
      <input aria-label={`Color for ${label.name}`} type="color" value={label.color ?? '#c3a34a'}
        onChange={event => {
          const batch = startBatch('Change Notebook label color');
          useDocumentsStore.getState().updateLabel(document.id, label.id,
            { color: event.target.value });
          if (batch.opened) endBatch();
        }} />
      <span>{label.anchor.quote}</span>
      <button type="button" aria-label={`Remove label ${label.name}`} onClick={() => {
        const batch = startBatch('Remove Notebook label');
        useDocumentsStore.getState().removeLabel(document.id, label.id);
        if (batch.opened) endBatch();
      }}>×</button>
    </div>)}
    {document.links.map(link => {
      const missing = !documentLinkExists(link.target, { files: media, compositions, activeCompositionId, clips });
      return <div key={link.id} className="notebook-detail">
        <button type="button" className="notebook-detail"
          draggable={Boolean(resolveDocumentMediaDrag(link.target, media))}
          onDragStart={event => {
            const payload = resolveDocumentMediaDrag(link.target, media);
            if (!payload) { event.preventDefault(); return; }
            event.dataTransfer.setData('application/x-media-file-id', payload.mediaId);
            event.dataTransfer.setData(DOCUMENT_MEDIA_REFERENCE_MIME, JSON.stringify(payload));
            event.dataTransfer.effectAllowed = 'copy';
            const file = media.find(item => item.id === payload.mediaId);
            if (file) setExternalDragPayload(createExternalDragPayloadForProjectItem(file));
          }}
          onDragEnd={() => clearExternalDragPayload()}
          onClick={() => void navigateLink(link.target)}>
          {link.anchor.status === 'orphaned' ? 'Unresolved passage · ' : ''}
          {missing ? 'Missing target · ' : ''}
          {link.label || link.target.kind}
        </button>
        <button type="button" onClick={() => {
          const anchor = captureSelection();
          if (!anchor?.quote) { notice('Select a passage to repair this reference.'); return; }
          const batch = startBatch('Repair Notebook reference');
          useDocumentsStore.getState().updateLinkAnchor(document.id, link.id, anchor);
          if (batch.opened) endBatch();
        }}>Repair passage</button>
        {missing && <select aria-label="Repair media target" value="" onChange={event => {
          const batch = startBatch('Repair Notebook media target');
          useDocumentsStore.getState().updateLinkTarget(document.id, link.id,
            { kind: 'source', mediaId: event.target.value });
          if (batch.opened) endBatch();
        }}>
          <option value="">Choose media…</option>
          {media.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>}
        <button type="button" aria-label="Remove media reference" onClick={() => {
          const batch = startBatch('Remove Notebook reference');
          useDocumentsStore.getState().removeLink(document.id, link.id);
          if (batch.opened) endBatch();
        }}>×</button>
      </div>;
    })}
    {document.comments.map(comment => <div key={comment.id} className="notebook-detail">Comment: {comment.text}</div>)}
  </aside>;
}
