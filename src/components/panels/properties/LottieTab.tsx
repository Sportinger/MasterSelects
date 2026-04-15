import { useCallback } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  type VectorAnimationClipSettings,
} from '../../../types/vectorAnimation';

interface LottieTabProps {
  clipId: string;
}

function cleanBackgroundColor(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function LottieTab({ clipId }: LottieTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((current) => current.id === clipId));
  const files = useMediaStore((state) => state.files);

  const mediaFile = clip?.source?.mediaFileId
    ? files.find((file) => file.id === clip.source?.mediaFileId)
    : undefined;
  const metadata = mediaFile?.vectorAnimation;
  const settings: VectorAnimationClipSettings = {
    ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
    ...clip?.source?.vectorAnimationSettings,
  };
  const animationNames = metadata?.animationNames ?? [];

  const updateSettings = useCallback((updates: Partial<VectorAnimationClipSettings>) => {
    const { clips } = useTimelineStore.getState();
    const current = clips.find((candidate) => candidate.id === clipId);
    if (!current?.source || current.source.type !== 'lottie') {
      return;
    }

    useTimelineStore.setState({
      clips: clips.map((candidate) =>
        candidate.id === clipId
          ? {
              ...candidate,
              source: {
                ...candidate.source!,
                vectorAnimationSettings: {
                  ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                  ...candidate.source?.vectorAnimationSettings,
                  ...updates,
                },
              },
            }
          : candidate
      ),
    });
  }, [clipId]);

  if (!clip || clip.source?.type !== 'lottie') {
    return null;
  }

  return (
    <div className="properties-tab-content" style={{ padding: '10px', display: 'grid', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div>
          <div style={{ color: '#ddd', fontSize: '12px', fontWeight: 600 }}>{clip.name}</div>
          <div style={{ color: '#888', fontSize: '11px' }}>
            {metadata?.width && metadata?.height ? `${metadata.width} x ${metadata.height}` : 'Canvas-backed animation'}
            {metadata?.fps ? ` • ${metadata.fps.toFixed(2)} fps` : ''}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#bbb', fontSize: '11px' }}>
          <input
            type="checkbox"
            checked={settings.loop}
            onChange={(event) => updateSettings({ loop: event.target.checked })}
          />
          Loop
        </label>
      </div>

      <label style={{ display: 'grid', gap: '4px', fontSize: '11px', color: '#999' }}>
        End Behavior
        <select
          value={settings.endBehavior}
          onChange={(event) => updateSettings({ endBehavior: event.target.value as VectorAnimationClipSettings['endBehavior'] })}
        >
          <option value="hold">Hold last frame</option>
          <option value="clear">Clear</option>
          <option value="loop">Loop</option>
        </select>
      </label>

      <label style={{ display: 'grid', gap: '4px', fontSize: '11px', color: '#999' }}>
        Fit
        <select
          value={settings.fit}
          onChange={(event) => updateSettings({ fit: event.target.value as VectorAnimationClipSettings['fit'] })}
        >
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="fill">Fill</option>
        </select>
      </label>

      {animationNames.length > 0 && (
        <label style={{ display: 'grid', gap: '4px', fontSize: '11px', color: '#999' }}>
          Animation
          <select
            value={settings.animationName ?? metadata?.defaultAnimationName ?? animationNames[0]}
            onChange={(event) => updateSettings({ animationName: event.target.value || undefined })}
          >
            {animationNames.map((animationName) => (
              <option key={animationName} value={animationName}>
                {animationName}
              </option>
            ))}
          </select>
        </label>
      )}

      <div style={{ display: 'grid', gap: '4px' }}>
        <span style={{ fontSize: '11px', color: '#999' }}>Background</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="color"
            value={settings.backgroundColor ?? '#000000'}
            onChange={(event) => updateSettings({ backgroundColor: event.target.value })}
            style={{ width: '32px', height: '24px', padding: 0, border: '1px solid #3a3a3a', borderRadius: '4px', background: 'transparent' }}
          />
          <input
            type="text"
            value={settings.backgroundColor ?? ''}
            onChange={(event) => updateSettings({ backgroundColor: cleanBackgroundColor(event.target.value) })}
            placeholder="transparent"
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </div>
  );
}
