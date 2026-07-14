import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { endBatch, startBatch } from '../../../stores/historyStore';
import {
  DEFAULT_LIGHT_CLIP_SETTINGS,
  hexToRgb01,
  type LightProperty,
  mergeLightClipSettings,
  type LightClipSettings,
  type LightKind,
} from '../../../types/light';
import { DraggableNumber, KeyframeToggle, MultiKeyframeToggle } from './shared';

interface LightTabProps {
  clipId: string;
}

const KIND_OPTIONS: Array<{ value: LightKind; label: string }> = [
  { value: 'point', label: 'Point' },
  { value: 'panel', label: 'Panel' },
  { value: 'environment', label: 'Environment' },
];

function stripEnvironmentMap(settings: Partial<LightClipSettings> | undefined): Partial<LightClipSettings> {
  if (!settings) return {};
  const {
    environmentMapMediaFileId: _environmentMapMediaFileId,
    environmentMapUrl: _environmentMapUrl,
    environmentMapFileName: _environmentMapFileName,
    ...rest
  } = settings;
  return rest;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function averageImageColor(src: string): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  try {
    const image = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] ?? 255;
      if (alpha === 0) continue;
      r += pixels[index] ?? 0;
      g += pixels[index + 1] ?? 0;
      b += pixels[index + 2] ?? 0;
      count += 1;
    }
    if (count === 0) return null;
    return `#${[r, g, b]
      .map((channel) => Math.round(channel / count).toString(16).padStart(2, '0'))
      .join('')}`;
  } catch {
    return null;
  }
}

export function LightTab({ clipId }: LightTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const imageFiles = useMediaStore((state) => state.files.filter((file) => file.type === 'image' && !!file.url));
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getInterpolatedLightSettings = useTimelineStore((state) => state.getInterpolatedLightSettings);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClip = useTimelineStore((state) => state.updateClip);
  useTimelineStore((state) => state.clipKeyframes);
  const latestClipRef = useRef(clip);
  const pendingEnvironmentMapIdRef = useRef<string | null>(null);

  useEffect(() => {
    latestClipRef.current = clip;
  }, [clip]);

  const settings = clip?.source?.type === 'light'
    ? getInterpolatedLightSettings(clipId, playheadPosition - clip.startTime)
    : DEFAULT_LIGHT_CLIP_SETTINGS;
  const colorChannels = useMemo(() => hexToRgb01(settings.color), [settings.color]);

  const updateStaticSetting = useCallback(<K extends keyof LightClipSettings>(key: K, value: LightClipSettings[K]) => {
    if (!clip?.source || clip.source.type !== 'light') return;

    const nextSettings = mergeLightClipSettings({
      ...clip.source.lightSettings,
      [key]: value,
    });
    updateClip(clipId, { source: { ...clip.source, lightSettings: nextSettings } });
  }, [clip, clipId, updateClip]);

  const handleKindChange = useCallback((kind: LightKind) => {
    if (!clip?.source || clip.source.type !== 'light') return;
    if (kind !== 'environment') {
      pendingEnvironmentMapIdRef.current = null;
    }

    const baseSettings = kind === 'environment'
      ? clip.source.lightSettings
      : stripEnvironmentMap(clip.source.lightSettings);
    updateClip(clipId, {
      source: {
        ...clip.source,
        lightSettings: mergeLightClipSettings({
          ...baseSettings,
          kind,
        }),
      },
    });
  }, [clip, clipId, updateClip]);

  const handleEnvironmentMapChange = useCallback((mediaFileId: string) => {
    if (!clip?.source || clip.source.type !== 'light') return;

    const selectedFile = imageFiles.find((file) => file.id === mediaFileId);
    pendingEnvironmentMapIdRef.current = selectedFile?.id ?? null;
    const baseSettings = stripEnvironmentMap(clip.source.lightSettings);
    const nextSettings = mergeLightClipSettings({
      ...baseSettings,
      kind: 'environment',
      ...(selectedFile ? {
        environmentMapMediaFileId: selectedFile.id,
        environmentMapUrl: selectedFile.url,
        environmentMapFileName: selectedFile.name,
      } : {}),
    });
    updateClip(clipId, { source: { ...clip.source, lightSettings: nextSettings } });

    if (!selectedFile?.url) return;
    void averageImageColor(selectedFile.url).then((color) => {
      if (!color) return;
      if (pendingEnvironmentMapIdRef.current !== selectedFile.id) return;
      const latestClip = latestClipRef.current;
      if (latestClip?.source?.type !== 'light') return;
      updateClip(clipId, {
        source: {
          ...latestClip.source,
          lightSettings: mergeLightClipSettings({
            ...latestClip.source.lightSettings,
            kind: 'environment',
            environmentMapMediaFileId: selectedFile.id,
            environmentMapUrl: selectedFile.url,
            environmentMapFileName: selectedFile.name,
            color,
          }),
        },
      });
    });
  }, [clip, clipId, imageFiles, updateClip]);

  const setAnimatedValue = useCallback((property: LightProperty, value: number) => {
    setPropertyValue(clipId, property, value);
  }, [clipId, setPropertyValue]);

  const handleColorChange = useCallback((color: string) => {
    const [r, g, b] = hexToRgb01(color);
    setPropertyValue(clipId, 'light.color.r', r);
    setPropertyValue(clipId, 'light.color.g', g);
    setPropertyValue(clipId, 'light.color.b', b);
  }, [clipId, setPropertyValue]);

  const handleDragStart = useCallback(() => {
    startBatch('Light setting');
  }, []);

  const handleDragEnd = useCallback(() => {
    endBatch();
  }, []);

  if (!clip || clip.source?.type !== 'light') return null;

  return (
    <div className="gaussian-splat-tab" style={{ padding: '8px 10px', fontSize: '11px' }}>
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#aaa' }}>{clip.name}</span>
        <span style={{
          background: '#4c4526',
          color: '#f3dd6b',
          padding: '1px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 500,
        }}>
          Scene Light
        </span>
      </div>

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
        <label style={{ width: '86px', color: '#999', flexShrink: 0 }}>Type</label>
        <select
          value={settings.kind}
          onChange={(e) => handleKindChange(e.target.value as LightKind)}
          style={{ flex: 1 }}
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {settings.kind === 'environment' && (
        <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
          <label style={{ width: '86px', color: '#999', flexShrink: 0 }}>Env Map</label>
          <select
            value={settings.environmentMapMediaFileId ?? ''}
            onChange={(event) => handleEnvironmentMapChange(event.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">None</option>
            {imageFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
        <label style={{ width: '86px', color: '#999', flexShrink: 0 }}>Color</label>
        <input
          type="color"
          value={settings.color}
          onChange={(event) => handleColorChange(event.target.value)}
          style={{ width: '34px', height: '22px', padding: 0, border: '1px solid #3a3a3a', borderRadius: '3px', background: 'transparent' }}
        />
        <span style={{ color: '#777', fontFamily: 'monospace', minWidth: '58px' }}>{settings.color}</span>
        <MultiKeyframeToggle
          clipId={clipId}
          dragId={`${clipId}:light-color`}
          title="Add color keyframes"
          entries={[
            { property: 'light.color.r', value: colorChannels[0] },
            { property: 'light.color.g', value: colorChannels[1] },
            { property: 'light.color.b', value: colorChannels[2] },
          ]}
        />
      </div>

      <LightNumberRow
        clipId={clipId}
        label="Intensity"
        property="light.intensity"
        value={settings.intensity}
        defaultValue={DEFAULT_LIGHT_CLIP_SETTINGS.intensity}
        min={0}
        max={20}
        sensitivity={0.05}
        decimals={2}
        onChange={(value) => setAnimatedValue('light.intensity', Math.max(0, value))}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />

      <LightNumberRow
        clipId={clipId}
        label="Diameter"
        property="light.diameter"
        value={settings.diameter}
        defaultValue={DEFAULT_LIGHT_CLIP_SETTINGS.diameter}
        min={0.01}
        max={100}
        sensitivity={0.05}
        decimals={2}
        onChange={(value) => setAnimatedValue('light.diameter', Math.max(0.01, value))}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />

      <div className="prop-row" style={{ display: 'flex', alignItems: 'center', margin: '8px 0 4px', gap: '6px' }}>
        <label style={{ width: '86px', color: '#999', flexShrink: 0 }}>Shadows</label>
        <input
          type="checkbox"
          checked={settings.castsShadows}
          onChange={(event) => updateStaticSetting('castsShadows', event.target.checked)}
        />
      </div>

      <LightNumberRow
        clipId={clipId}
        label="Shadow"
        property="light.shadowStrength"
        value={settings.shadowStrength}
        defaultValue={DEFAULT_LIGHT_CLIP_SETTINGS.shadowStrength}
        min={0}
        max={1}
        sensitivity={0.01}
        decimals={2}
        onChange={(value) => setAnimatedValue('light.shadowStrength', Math.min(1, Math.max(0, value)))}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />
    </div>
  );
}

function LightNumberRow({
  clipId,
  label,
  property,
  value,
  defaultValue,
  min,
  max,
  sensitivity,
  decimals,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  clipId: string;
  label: string;
  property: 'light.intensity' | 'light.diameter' | 'light.shadowStrength';
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  sensitivity: number;
  decimals: number;
  onChange: (value: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="prop-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
      <label style={{ width: '86px', color: '#999', flexShrink: 0 }}>{label}</label>
      <DraggableNumber
        value={value}
        onChange={onChange}
        defaultValue={defaultValue}
        persistenceKey={property}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        min={min}
        max={max}
        sensitivity={sensitivity}
        decimals={decimals}
      />
      <KeyframeToggle clipId={clipId} property={property} value={value} />
    </div>
  );
}
