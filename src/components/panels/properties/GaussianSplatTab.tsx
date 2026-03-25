// Gaussian Splat properties tab — render settings for gaussian splat clips

import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useHistoryStore } from '../../../stores/historyStore';
import { DraggableNumber } from './shared';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../../engine/gaussian/types';
import type { GaussianSplatSettings, GaussianSplatRenderSettings } from '../../../engine/gaussian/types';

interface GaussianSplatTabProps {
  clipId: string;
}

export function GaussianSplatTab({ clipId }: GaussianSplatTabProps) {
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const settings: GaussianSplatSettings = clip?.source?.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
  const render = settings.render;

  const updateRenderSetting = useCallback(<K extends keyof GaussianSplatRenderSettings>(key: K, value: GaussianSplatRenderSettings[K]) => {
    const { clips, updateDuration } = useTimelineStore.getState();
    const current = clips.find(c => c.id === clipId);
    if (!current?.source) return;

    const currentSettings = current.source.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
    const newSettings: GaussianSplatSettings = {
      ...currentSettings,
      render: { ...currentSettings.render, [key]: value },
    };

    useTimelineStore.setState({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, source: { ...c.source!, gaussianSplatSettings: newSettings } }
          : c
      ),
    });
    updateDuration();
  }, [clipId]);

  const handleDragStart = useCallback(() => {
    useHistoryStore.getState().startBatch('Gaussian Splat Setting');
  }, []);

  const handleDragEnd = useCallback(() => {
    useHistoryStore.getState().endBatch();
  }, []);

  if (!clip) return null;

  return (
    <div className="gaussian-splat-tab" style={{ padding: '8px 10px', fontSize: '11px' }}>
      {/* Info section */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#aaa' }}>{clip.name}</span>
        <span style={{
          background: '#2a5a4a',
          color: '#6aeaba',
          padding: '1px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 500,
        }}>
          Gaussian Splat
        </span>
      </div>

      {/* Render Settings */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
          Render Settings
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Splat Scale</label>
          <DraggableNumber
            value={render.splatScale}
            onChange={(v) => updateRenderSetting('splatScale', v)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={0.1}
            max={10}
            sensitivity={0.5}
            decimals={2}
          />
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Near Plane</label>
          <DraggableNumber
            value={render.nearPlane}
            onChange={(v) => updateRenderSetting('nearPlane', v)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={0.01}
            max={10}
            sensitivity={0.5}
            decimals={2}
          />
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Far Plane</label>
          <DraggableNumber
            value={render.farPlane}
            onChange={(v) => updateRenderSetting('farPlane', v)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={10}
            max={10000}
            sensitivity={20}
            decimals={0}
          />
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Max Splats</label>
          <DraggableNumber
            value={render.maxSplats}
            onChange={(v) => updateRenderSetting('maxSplats', Math.round(v))}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={0}
            max={10000000}
            sensitivity={200}
            decimals={0}
            suffix={render.maxSplats === 0 ? ' (unlimited)' : ''}
          />
        </div>
      </div>

      {/* Deferred sections — Coming Soon placeholders */}
      <div style={{ marginBottom: '14px', opacity: 0.4 }}>
        <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Temporal Settings
          <span style={{ fontSize: '9px', background: '#333', color: '#777', padding: '1px 4px', borderRadius: '2px', textTransform: 'none', letterSpacing: 0 }}>Coming Soon</span>
        </div>
        <div style={{ padding: '6px 0', color: '#555', fontSize: '10px' }}>
          Animation playback, frame interpolation, and temporal filtering controls.
        </div>
      </div>

      <div style={{ opacity: 0.4 }}>
        <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Particle Settings
          <span style={{ fontSize: '9px', background: '#333', color: '#777', padding: '1px 4px', borderRadius: '2px', textTransform: 'none', letterSpacing: 0 }}>Coming Soon</span>
        </div>
        <div style={{ padding: '6px 0', color: '#555', fontSize: '10px' }}>
          Per-splat color grading, opacity curves, and size distributions.
        </div>
      </div>
    </div>
  );
}
