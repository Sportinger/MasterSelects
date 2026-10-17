import { useMemo, useRef, useState, type DragEvent } from 'react';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from '../properties/resolveInspector/ResolveInspectorNumberRow';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../properties/sharedConstants';
import { Logger } from '../../../services/logger';
import { getImageLayers } from '../../../services/imageDocument/imageLayers';
import {
  addImageLayersFromFiles,
  addSolidLayer,
  addTextLayer,
  createImageDocumentFromCurrentFrame,
  deleteImageLayer,
  exportActiveImageAsPng,
} from '../../../services/imageDocument/imageDocumentService';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { BlendMode } from '../../../types/blendMode';
import { DownloadIcon, NewDocumentIcon, PlusImageIcon, SolidIcon, TextIcon, TrashIcon } from './LayerIcons';
import { LayerRow } from './LayerRow';
import { NewImageForm } from './NewImageForm';
import './LayersPanel.css';

const log = Logger.create('LayersPanel');

const BLEND_GROUPS = BLEND_MODE_GROUPS.map((group) => ({
  label: group.label,
  options: group.modes.map((mode) => ({ value: mode, label: formatBlendModeName(mode) })),
}));

function runAction(label: string, action: () => Promise<unknown>) {
  void action().catch((error: unknown) => log.warn(`${label} failed`, error));
}

export function LayersPanel() {
  const composition = useMediaStore((state) => state.compositions.find((comp) => comp.id === state.activeCompositionId) ?? null);
  const still = composition?.still === true;
  const tracks = useTimelineStore((state) => state.tracks);
  const clips = useTimelineStore((state) => state.clips);
  // A still document ignores the playhead, so it does not re-render during playback.
  const playheadPosition = useTimelineStore((state) => (still ? 0 : state.playheadPosition));
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const layers = useMemo(
    () => (composition ? getImageLayers(tracks, clips, { still, time: playheadPosition }) : []),
    [clips, composition, playheadPosition, still, tracks],
  );
  const selectedLayer = layers.find((layer) => selectedClipIds.has(layer.clip.id)) ?? null;
  const [dropTarget, setDropTarget] = useState<{ trackId: string; position: 'above' | 'below' } | null>(null);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [showNewImage, setShowNewImage] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!composition || showNewImage) {
    return (
      <div className="layers-panel">
        {composition && (
          <div className="layers-header">
            <div className="layers-title"><strong>New image</strong></div>
            <button onClick={() => setShowNewImage(false)} type="button">Back to layers</button>
          </div>
        )}
        <NewImageForm
          canUseCurrentFrame={composition !== null}
          onCreated={() => setShowNewImage(false)}
          onCurrentFrame={() => runAction('Image from frame', async () => {
            await createImageDocumentFromCurrentFrame();
            setShowNewImage(false);
          })}
        />
      </div>
    );
  }

  const timeline = useTimelineStore.getState();
  const selectLayer = (clipId: string, additive: boolean) => timeline.selectClip(clipId, additive);
  const dropOnRow = (sourceTrackId: string, targetTrackId: string) => {
    const position = dropTarget?.trackId === targetTrackId ? dropTarget.position : 'above';
    setDropTarget(null);
    if (sourceTrackId !== targetTrackId) timeline.reorderTrack(sourceTrackId, targetTrackId, position === 'below');
  };
  const handlePanelDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setFileDropActive(true);
  };
  const handlePanelDrop = (event: DragEvent<HTMLDivElement>) => {
    setFileDropActive(false);
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    runAction('Adding dropped layers', () => addImageLayersFromFiles(files));
  };

  return (
    <div
      className={`layers-panel${fileDropActive ? ' file-drop' : ''}`}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDropActive(false);
      }}
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
    >
      <div className="layers-header">
        <div className="layers-title">
          <strong title={composition.name}>{composition.name}</strong>
          <span>{composition.width} × {composition.height}{still ? '' : ' · video'}</span>
        </div>
        <button
          aria-label="New image"
          className="layers-icon-button"
          onClick={() => setShowNewImage(true)}
          title="New image"
          type="button"
        >
          <NewDocumentIcon />
        </button>
        <button
          aria-label="Save as PNG"
          className="layers-icon-button"
          onClick={() => runAction('PNG export', exportActiveImageAsPng)}
          title="Save as PNG"
          type="button"
        >
          <DownloadIcon />
        </button>
      </div>

      {!still && (
        <div className="layers-notice">
          <span>Video composition: showing the layers at the playhead.</span>
          <button onClick={() => runAction('Image from frame', createImageDocumentFromCurrentFrame)} type="button">
            Image from this frame
          </button>
        </div>
      )}

      {selectedLayer && (
        <div className="layers-blend">
          <InspectorSelect
            ariaLabel="Layer blend mode"
            groups={BLEND_GROUPS}
            onChange={(mode) => timeline.updateClipTransform(selectedLayer.clip.id, { blendMode: mode as BlendMode })}
            onReset={() => timeline.updateClipTransform(selectedLayer.clip.id, { blendMode: 'normal' })}
            value={selectedLayer.clip.transform.blendMode}
          />
          <ResolveInspectorNumberRow
            defaultValue={100}
            label="Opacity"
            max={100}
            min={0}
            onChange={(percent) => timeline.setPropertyValue(selectedLayer.clip.id, 'opacity', percent / 100)}
            step={1}
            suffix="%"
            value={selectedLayer.clip.transform.opacity * 100}
          />
        </div>
      )}

      <div aria-label="Layers" className="layers-list" onDragLeave={() => setDropTarget(null)} role="listbox">
        {layers.length === 0 && (
          <div className="layers-empty">
            {still ? 'No layers yet. Add an image, text, or drop files here.' : 'No visual clip under the playhead.'}
          </div>
        )}
        {layers.map((layer) => (
          <LayerRow
            dropPosition={dropTarget?.trackId === layer.track.id ? dropTarget.position : null}
            key={layer.clip.id}
            layer={layer}
            onDragOverRow={(trackId, position) => setDropTarget({ trackId, position })}
            onDropOnRow={dropOnRow}
            onRename={(clipId, name) => timeline.updateClip(clipId, { name })}
            onSelect={selectLayer}
            onToggleLocked={(trackId, locked) => timeline.setTrackLocked(trackId, locked)}
            onToggleVisible={(trackId, visible) => timeline.setTrackVisible(trackId, visible)}
            selected={selectedClipIds.has(layer.clip.id)}
          />
        ))}
      </div>

      <div className="layers-toolbar">
        <button aria-label="Add image layer" className="layers-icon-button" onClick={() => fileInput.current?.click()} title="Add image layer" type="button">
          <PlusImageIcon />
        </button>
        <button aria-label="Add text layer" className="layers-icon-button" onClick={() => runAction('Text layer', addTextLayer)} title="Add text layer" type="button">
          <TextIcon />
        </button>
        <button aria-label="Add color layer" className="layers-icon-button" onClick={() => addSolidLayer()} title="Add color layer" type="button">
          <SolidIcon />
        </button>
        <span className="layers-toolbar-spacer" />
        <button
          aria-label="Delete layer"
          className="layers-icon-button"
          disabled={!selectedLayer || selectedLayer.track.locked === true}
          onClick={() => { if (selectedLayer) deleteImageLayer(selectedLayer.clip.id); }}
          title="Delete layer"
          type="button"
        >
          <TrashIcon />
        </button>
      </div>
      <input
        accept="image/*,video/*"
        hidden
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) runAction('Adding image layers', () => addImageLayersFromFiles(files));
        }}
        ref={fileInput}
        type="file"
      />
    </div>
  );
}
