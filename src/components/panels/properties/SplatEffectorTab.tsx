import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useHistoryStore } from '../../../stores/historyStore';
import { DraggableNumber } from './shared';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../../types/splatEffector';
import type { SplatEffectorMode, SplatEffectorSettings } from '../../../types/splatEffector';

interface SplatEffectorTabProps {
  clipId: string;
}

const MODE_OPTIONS: Array<{ value: SplatEffectorMode; label: string }> = [
  { value: 'repel', label: 'Repel' },
  { value: 'attract', label: 'Attract' },
  { value: 'swirl', label: 'Swirl' },
  { value: 'noise', label: 'Noise' },
];

export function SplatEffectorTab({ clipId }: SplatEffectorTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const settings: SplatEffectorSettings = clip?.source?.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS;

  const updateSetting = useCallback(<K extends keyof SplatEffectorSettings>(key: K, value: SplatEffectorSettings[K]) => {
    const state = useTimelineStore.getState();
    const current = state.clips.find((c) => c.id === clipId);
    if (!current?.source || current.source.type !== 'splat-effector') return;

    const nextSettings: SplatEffectorSettings = {
      ...(current.source.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS),
      [key]: value,
    };

    useTimelineStore.setState({
      clips: state.clips.map((c) =>
        c.id === clipId
          ? { ...c, source: { ...c.source!, splatEffectorSettings: nextSettings } }
          : c
      ),
    });
    state.invalidateCache();
  }, [clipId]);

  const handleDragStart = useCallback(() => {
    useHistoryStore.getState().startBatch('3D effector setting');
  }, []);

  const handleDragEnd = useCallback(() => {
    useHistoryStore.getState().endBatch();
  }, []);

  if (!clip || clip.source?.type !== 'splat-effector') return null;

  return (
    <div className="gaussian-splat-tab" style={{ padding: '8px 10px', fontSize: '11px' }}>
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#aaa' }}>{clip.name}</span>
        <span
          style={{
            background: '#254434',
            color: '#b6f1cb',
            padding: '1px 6px',
            borderRadius: '3px',
            fontSize: '10px',
            fontWeight: 500,
          }}
        >
          Scene Effector
        </span>
      </div>

      <div style={{ marginBottom: '8px', color: '#8d99a6', lineHeight: 1.45 }}>
        Active 3D effector clips influence scene-driven 3D objects at playback time. Splats deform directly; models, primitives, and 3D text receive object-level motion. 3D planes stay excluded in phase 1. Transform controls position, rotation, and radius via scale.
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
        <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Mode</label>
        <select
          value={settings.mode}
          onChange={(e) => updateSetting('mode', e.target.value as SplatEffectorMode)}
          style={{ flex: 1 }}
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Strength</label>
        <DraggableNumber
          value={settings.strength}
          onChange={(v) => updateSetting('strength', Math.max(0, v))}
          persistenceKey="splatEffector.strength"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={0}
          max={400}
          sensitivity={0.5}
          decimals={1}
          suffix="%"
        />
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Falloff</label>
        <DraggableNumber
          value={settings.falloff}
          onChange={(v) => updateSetting('falloff', Math.max(0.1, v))}
          persistenceKey="splatEffector.falloff"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={0.1}
          max={8}
          sensitivity={0.05}
          decimals={2}
        />
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Speed</label>
        <DraggableNumber
          value={settings.speed}
          onChange={(v) => updateSetting('speed', Math.max(0, v))}
          persistenceKey="splatEffector.speed"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={0}
          max={20}
          sensitivity={0.05}
          decimals={2}
        />
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
        <label style={{ width: '80px', color: '#999', flexShrink: 0 }}>Seed</label>
        <DraggableNumber
          value={settings.seed}
          onChange={(v) => updateSetting('seed', v)}
          persistenceKey="splatEffector.seed"
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          min={-10000}
          max={10000}
          sensitivity={1}
          decimals={0}
        />
      </div>
    </div>
  );
}
