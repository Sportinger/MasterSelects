import { useEffect, useRef, useState } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { LENS_CORRECTION_PARAMS, normalizeLensCorrection } from '../../../effects/distort/lens-correction';
import { CANON_24_105_PROFILE, LENS_PROFILE_OPTIONS } from '../../../effects/distort/lens-correction/lensProfile';
import { getRawPhotoMetadata, isRawImageFile } from '../../../services/rawImage/rawImageDecode';
import type { RawPhotoMetadata } from '../../../services/rawImage/rawPhotoMetadata';
import { useTimelineStore } from '../../../stores/timeline';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { EffectKeyframeToggle } from './shared';

export function LensCorrectionControls({ params, onChange, clipId, effectInstanceId }: EffectControlProps) {
  const file = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.file);
  const [metadata, setMetadata] = useState<RawPhotoMetadata>();
  const [metadataError, setMetadataError] = useState(false);
  const latest = useRef({ params, onChange });
  latest.current = { params, onChange };
  useEffect(() => {
    let current = true;
    setMetadata(undefined); setMetadataError(false);
    if (file && isRawImageFile(file)) void getRawPhotoMetadata(file).then(value => {
      if (current) setMetadata(value);
    }).catch(() => { if (current) setMetadataError(true); });
    return () => { current = false; };
  }, [file]);
  const p = normalizeLensCorrection(params);
  const profile = params.profile === CANON_24_105_PROFILE ? CANON_24_105_PROFILE : 'manual';
  const change = (key: string, value: number | string) => onChange({ ...params,
    ...(metadata ? { sourceAspect: metadata.width / metadata.height } : {}), [key]: value });
  const selectProfile = (value: string) => {
    const current = latest.current;
    current.onChange({ ...current.params, profile: value,
      ...(value === CANON_24_105_PROFILE && metadata ? {
        focalLength: Math.max(24, Math.min(105, metadata.focalLength || 24)),
        aperture: Math.max(4, Math.min(22, metadata.aperture || 4)),
        sourceAspect: metadata.width / metadata.height,
      } : value === CANON_24_105_PROFILE ? { sourceAspect: 0 } : {}),
    });
  };
  const rows = (group: string) => Object.entries(LENS_CORRECTION_PARAMS)
    .filter(([, def]) => def.type === 'number' && !def.hidden && def.group === group)
    .map(([key, def]) => <ResolveInspectorNumberRow key={key} label={def.label}
      value={p[key]} defaultValue={def.default as number} min={def.min!} max={def.max!}
      hardMin={def.min!} hardMax={def.max!} step={def.step!} sensitivity={(def.max! - def.min!) / 100}
      decimals={def.step! >= 0.1 ? 1 : 3} suffix={key === 'focalLength' ? 'mm' : key === 'focusDistance' ? 'm' : undefined}
      persistenceKey={`effect.${clipId ?? 'global'}.${effectInstanceId ?? 'lens-correction'}.${key}`}
      onChange={value => change(key, value)}
      keyframeToggle={clipId && effectInstanceId && def.animatable
        ? <EffectKeyframeToggle clipId={clipId} effectId={effectInstanceId} paramName={key} value={p[key]} /> : undefined} />);
  return <div className="effects-tab transform-tab-compact">
    <ResolveInspectorSection title="Lens profile" indicator="none">
      <ResolveInspectorRow label="Lens"><InspectorSelect ariaLabel="Lens profile" value={profile}
        options={LENS_PROFILE_OPTIONS} onChange={selectProfile} /></ResolveInspectorRow>
      {metadata && <p className="effect-info">{metadata.lens} · {metadata.focalLength} mm · f/{metadata.aperture}</p>}
      {metadataError && <p className="effect-info" role="status">Camera metadata unavailable. Set focal length and aperture below.</p>}
      {profile !== 'manual' && <>{rows('profile')}<p className="effect-info">
        Lensfun full-frame calibration. Set Sensor Crop for APS-C; 1000 m approximates infinity when focus distance is unknown.
      </p></>}
    </ResolveInspectorSection>
    {['geometry', 'chromatic aberration', 'vignette'].map(group => <ResolveInspectorSection
      key={group} title={group === 'geometry' ? 'Geometry' : group === 'vignette' ? 'Vignette' : 'Chromatic aberration'}
      indicator="none" defaultOpen={group === 'geometry'}>{rows(group)}</ResolveInspectorSection>)}
  </div>;
}
