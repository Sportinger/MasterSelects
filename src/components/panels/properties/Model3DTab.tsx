import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  DEFAULT_MODEL_MATERIAL_SETTINGS,
  mergeModelMaterialSettings,
  type ModelMaterialSettings,
  type ModelMaterialShading,
} from '../../../types/modelMaterial';
import { DraggableNumber } from './shared';

interface Model3DTabProps {
  clipId: string;
}

const SHADING_OPTIONS: Array<{ value: ModelMaterialShading; label: string }> = [
  { value: 'asset', label: 'Asset' },
  { value: 'lit', label: 'Lit' },
  { value: 'unlit', label: 'Unlit' },
];

export function Model3DTab({ clipId }: Model3DTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const updateClip = useTimelineStore((state) => state.updateClip);
  const settings = mergeModelMaterialSettings(
    clip?.source?.type === 'model' ? clip.source.modelMaterialSettings : undefined,
  );

  const updateSettings = useCallback((patch: Partial<ModelMaterialSettings>) => {
    if (!clip?.source || clip.source.type !== 'model') return;
    updateClip(clipId, {
      source: {
        ...clip.source,
        modelMaterialSettings: mergeModelMaterialSettings({
          ...clip.source.modelMaterialSettings,
          ...patch,
        }),
      },
    });
  }, [clip, clipId, updateClip]);

  if (!clip || clip.source?.type !== 'model') return null;

  return (
    <div className="gaussian-splat-tab" style={{ padding: '8px 10px', fontSize: '11px' }}>
      <ModelRow label="Color">
        <input
          type="checkbox"
          checked={settings.overrideBaseColor}
          onChange={(event) => updateSettings({ overrideBaseColor: event.target.checked })}
        />
        <input
          type="color"
          value={settings.baseColor}
          onChange={(event) => updateSettings({ baseColor: event.target.value, overrideBaseColor: true })}
          style={{ width: '34px', height: '22px', padding: 0, border: '1px solid #3a3a3a', borderRadius: '3px', background: 'transparent' }}
        />
        <span style={{ color: '#777', fontFamily: 'monospace', minWidth: '58px' }}>{settings.baseColor}</span>
      </ModelRow>

      <ModelRow label="Texture">
        <input
          type="checkbox"
          checked={settings.useEmbeddedTexture}
          onChange={(event) => updateSettings({ useEmbeddedTexture: event.target.checked })}
        />
      </ModelRow>

      <ModelRow label="Shading">
        <select
          value={settings.shading}
          onChange={(event) => updateSettings({ shading: event.target.value as ModelMaterialShading })}
          style={{ flex: 1 }}
        >
          {SHADING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </ModelRow>

      <ModelNumberRow
        label="UV Scale X"
        value={settings.uvScaleX}
        defaultValue={DEFAULT_MODEL_MATERIAL_SETTINGS.uvScaleX}
        onChange={(value) => updateSettings({ uvScaleX: value })}
      />
      <ModelNumberRow
        label="UV Scale Y"
        value={settings.uvScaleY}
        defaultValue={DEFAULT_MODEL_MATERIAL_SETTINGS.uvScaleY}
        onChange={(value) => updateSettings({ uvScaleY: value })}
      />
      <ModelNumberRow
        label="UV Offset X"
        value={settings.uvOffsetX}
        defaultValue={DEFAULT_MODEL_MATERIAL_SETTINGS.uvOffsetX}
        onChange={(value) => updateSettings({ uvOffsetX: value })}
      />
      <ModelNumberRow
        label="UV Offset Y"
        value={settings.uvOffsetY}
        defaultValue={DEFAULT_MODEL_MATERIAL_SETTINGS.uvOffsetY}
        onChange={(value) => updateSettings({ uvOffsetY: value })}
      />
    </div>
  );
}

function ModelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
      <label style={{ width: '86px', color: '#999', flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
}

function ModelNumberRow({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <ModelRow label={label}>
      <DraggableNumber
        value={value}
        onChange={onChange}
        defaultValue={defaultValue}
        persistenceKey={`model-material-${label}`}
        onDragStart={() => startBatch('3D material')}
        onDragEnd={() => endBatch()}
        min={-100}
        max={100}
        sensitivity={0.01}
        decimals={3}
      />
    </ModelRow>
  );
}
