import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useHistoryStore } from '../../../stores/historyStore';
import { DraggableNumber } from './shared';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../../stores/mediaStore';
import type { SceneCameraSettings } from '../../../stores/mediaStore';
import { MIDIParameterLabel } from './MIDIParameterLabel';

interface CameraTabProps {
  clipId: string;
}

export function CameraTab({ clipId }: CameraTabProps) {
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const cameraSettings: SceneCameraSettings = clip?.source?.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;

  const updateCameraSetting = useCallback(<K extends keyof SceneCameraSettings>(key: K, value: SceneCameraSettings[K]) => {
    const { clips } = useTimelineStore.getState();
    const current = clips.find(c => c.id === clipId);
    if (!current?.source || current.source.type !== 'camera') return;

    const nextSettings: SceneCameraSettings = {
      ...(current.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS),
      [key]: value,
    };

    useTimelineStore.setState({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, source: { ...c.source!, cameraSettings: nextSettings } }
          : c
      ),
    });
  }, [clipId]);

  const handleDragStart = useCallback(() => {
    useHistoryStore.getState().startBatch('Camera setting');
  }, []);

  const handleDragEnd = useCallback(() => {
    useHistoryStore.getState().endBatch();
  }, []);

  if (!clip || clip.source?.type !== 'camera') return null;

  return (
    <div className="gaussian-splat-tab" style={{ padding: '8px 10px', fontSize: '11px' }}>
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#aaa' }}>{clip.name}</span>
        <span style={{
          background: '#4d422d',
          color: '#e7cd91',
          padding: '1px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 500,
        }}>
          Scene Camera
        </span>
      </div>

      <div style={{ marginBottom: '8px', color: '#8d99a6', lineHeight: 1.45 }}>
        This camera drives the common 3D scene for splats, planes, meshes, text, and models.
      </div>

      <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
        Lens
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <MIDIParameterLabel
          as="label"
          style={{ width: '80px', color: '#999', flexShrink: 0 }}
          target={{
            clipId,
            property: 'camera.fov',
            label: `${clip.name} / Camera FOV`,
            currentValue: cameraSettings.fov,
            min: 10,
            max: 140,
          }}
        >
          FOV
        </MIDIParameterLabel>
        <DraggableNumber
          value={cameraSettings.fov}
          onChange={(v) => updateCameraSetting('fov', Math.max(10, Math.min(140, v)))}
          defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.fov}
          persistenceKey="camera.fov"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={10}
          max={140}
          sensitivity={0.5}
          decimals={1}
          suffix="°"
        />
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <MIDIParameterLabel
          as="label"
          style={{ width: '80px', color: '#999', flexShrink: 0 }}
          target={{
            clipId,
            property: 'camera.near',
            label: `${clip.name} / Camera Near`,
            currentValue: cameraSettings.near,
            min: 0.001,
            max: 100,
          }}
        >
          Near
        </MIDIParameterLabel>
        <DraggableNumber
          value={cameraSettings.near}
          onChange={(v) => updateCameraSetting('near', Math.max(0.001, v))}
          defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.near}
          persistenceKey="camera.near"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={0.001}
          max={100}
          sensitivity={0.05}
          decimals={3}
        />
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <MIDIParameterLabel
          as="label"
          style={{ width: '80px', color: '#999', flexShrink: 0 }}
          target={{
            clipId,
            property: 'camera.far',
            label: `${clip.name} / Camera Far`,
            currentValue: cameraSettings.far,
            min: 1,
            max: 100000,
          }}
        >
          Far
        </MIDIParameterLabel>
        <DraggableNumber
          value={cameraSettings.far}
          onChange={(v) => updateCameraSetting('far', Math.max(cameraSettings.near + 0.1, v))}
          defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.far}
          persistenceKey="camera.far"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={1}
          max={100000}
          sensitivity={10}
          decimals={1}
        />
      </div>
    </div>
  );
}
