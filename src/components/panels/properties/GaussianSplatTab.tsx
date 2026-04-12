// Gaussian Splat properties tab - render settings for gaussian splat clips

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
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const settings: GaussianSplatSettings = clip?.source?.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
  const render = settings.render;
  const nativeRender = render.useNativeRenderer === true;
  const maxSplatsSuffix = render.maxSplats === 0
    ? (nativeRender ? ' (unlimited)' : ' (all)')
    : '';

  const updateRenderSetting = useCallback(<K extends keyof GaussianSplatRenderSettings>(key: K, value: GaussianSplatRenderSettings[K]) => {
    const { clips, updateDuration } = useTimelineStore.getState();
    const current = clips.find((c) => c.id === clipId);
    if (!current?.source) return;

    const currentSettings = current.source.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
    const nextSettings: GaussianSplatSettings = {
      ...currentSettings,
      render: { ...currentSettings.render, [key]: value },
    };

    useTimelineStore.setState({
      clips: clips.map((c) =>
        c.id === clipId
          ? { ...c, source: { ...c.source!, gaussianSplatSettings: nextSettings } }
          : c,
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

  const nativeOnlyStyle = nativeRender
    ? undefined
    : { opacity: 0.45, pointerEvents: 'none' as const };

  return (
    <div className="gaussian-splat-tab" style={{ padding: '8px 10px', fontSize: '11px' }}>
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#aaa' }}>{clip.name}</span>
        <span style={{
          background: '#4a5030',
          color: '#d9ef86',
          padding: '1px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 500,
        }}
        >
          Gaussian Splat
        </span>
      </div>

      <div style={{ marginBottom: '10px', color: '#8d99a6', lineHeight: 1.45 }}>
        {nativeRender
          ? 'Native render uses the dedicated WebGPU splat renderer and the splat-specific orbit camera.'
          : 'Three.js render places this splat in the shared 3D scene together with meshes, models, and scene cameras.'}
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
          Render Settings
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Native Render</label>
          <button
            className={`btn btn-xs ${nativeRender ? 'btn-active' : ''}`}
            onClick={() => updateRenderSetting('useNativeRenderer', !nativeRender)}
            title={nativeRender ? 'Use the native WebGPU splat renderer' : 'Use the shared Three.js 3D scene renderer'}
          >
            {nativeRender ? 'On' : 'Off'}
          </button>
          <span style={{ color: '#8d99a6', fontSize: '11px' }}>
            {nativeRender ? 'Dedicated native path' : 'Shared scene path'}
          </span>
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Splat Scale</label>
          <DraggableNumber
            value={render.splatScale}
            onChange={(value) => updateRenderSetting('splatScale', Math.max(0.01, value))}
            defaultValue={DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.splatScale}
            persistenceKey="gaussian.render.splatScale"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={0.01}
            max={20}
            sensitivity={0.02}
            decimals={2}
          />
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Max Splats</label>
          <DraggableNumber
            value={render.maxSplats}
            onChange={(value) => updateRenderSetting('maxSplats', Math.max(0, Math.round(value)))}
            defaultValue={DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.maxSplats}
            persistenceKey="gaussian.render.maxSplats"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={0}
            max={10000000}
            sensitivity={500}
            decimals={0}
            suffix={maxSplatsSuffix}
          />
        </div>

        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
          <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Sort Every</label>
          <DraggableNumber
            value={render.sortFrequency}
            onChange={(value) => updateRenderSetting('sortFrequency', Math.max(0, Math.round(value)))}
            defaultValue={DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.sortFrequency}
            persistenceKey="gaussian.render.sortFrequency"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            min={0}
            max={240}
            sensitivity={1}
            decimals={0}
            suffix={render.sortFrequency === 0 ? ' (off)' : ' frames'}
          />
        </div>

        <div style={nativeOnlyStyle}>
          <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
            <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Near Plane</label>
            <DraggableNumber
              value={render.nearPlane}
              onChange={(value) => updateRenderSetting('nearPlane', value)}
              defaultValue={DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.nearPlane}
              persistenceKey="gaussian.render.nearPlane"
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
              onChange={(value) => updateRenderSetting('farPlane', value)}
              defaultValue={DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.farPlane}
              persistenceKey="gaussian.render.farPlane"
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              min={10}
              max={10000}
              sensitivity={20}
              decimals={0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
