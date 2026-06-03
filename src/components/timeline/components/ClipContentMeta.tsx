import { memo, type CSSProperties } from 'react';
import type { TimelineClip } from '../../../types';
import type { ClipStaticIconKind } from '../utils/clipMediaClassification';
import { StaticClipIcon } from './ClipPresentationPrimitives';

interface ClipContentMetaProps {
  clip: TimelineClip;
  clipMetaOffset: number;
  displayDuration: number;
  formatTime: (seconds: number) => string;
  isSolidClip: boolean;
  isTextClip: boolean;
  isText3DClip: boolean;
  isMathSceneClip: boolean;
  isVectorAnimationClip: boolean;
  vectorAnimationIcon: string;
  vectorAnimationTitle: string;
  isSplatEffectorClip: boolean;
  staticClipIconKind: ClipStaticIconKind | null;
  text3DProperties: TimelineClip['text3DProperties'];
}

function resolveClipDisplayName({
  clip,
  isTextClip,
  isText3DClip,
  isMathSceneClip,
  text3DProperties,
}: Pick<ClipContentMetaProps, 'clip' | 'isTextClip' | 'isText3DClip' | 'isMathSceneClip' | 'text3DProperties'>): string {
  if (isTextClip && clip.textProperties) {
    return clip.textProperties.text.slice(0, 30) || 'Text';
  }
  if (isMathSceneClip && clip.mathScene) {
    return clip.mathScene.objects.find((object) => object.type === 'function')?.expression || 'Math Scene';
  }
  if (isText3DClip && text3DProperties) {
    return text3DProperties.text.slice(0, 30) || '3D Text';
  }
  return clip.name;
}

export const ClipContentMeta = memo(function ClipContentMeta({
  clip,
  clipMetaOffset,
  displayDuration,
  formatTime,
  isSolidClip,
  isTextClip,
  isText3DClip,
  isMathSceneClip,
  isVectorAnimationClip,
  vectorAnimationIcon,
  vectorAnimationTitle,
  isSplatEffectorClip,
  staticClipIconKind,
  text3DProperties,
}: ClipContentMetaProps) {
  const metaStyle: CSSProperties | undefined = clipMetaOffset > 0
    ? { transform: `translateX(${clipMetaOffset}px)` }
    : undefined;

  return (
    <div className="clip-content">
      <div className="clip-meta" style={metaStyle}>
        {clip.isLoading && <div className="clip-loading-spinner" />}
        <div className="clip-name-row">
          {isSolidClip && (
            <span className="clip-solid-swatch" title="Solid Clip" style={{ background: clip.solidColor || '#fff' }} />
          )}
          {(isTextClip || isText3DClip) && (
            <span className="clip-text-icon" title={isText3DClip ? '3D Text Clip' : 'Text Clip'}>
              {isText3DClip ? '3T' : 'T'}
            </span>
          )}
          {isVectorAnimationClip && (
            <span className="clip-text-icon" title={vectorAnimationTitle}>{vectorAnimationIcon}</span>
          )}
          {isMathSceneClip && (
            <span className="clip-text-icon" title="Math Scene Clip">&#402;</span>
          )}
          {staticClipIconKind && (
            <StaticClipIcon
              kind={staticClipIconKind}
              className="clip-type-icon"
            />
          )}
          {isSplatEffectorClip && (
            <span className="clip-text-icon" title="3D Effector Clip">E</span>
          )}
          <span className="clip-name">
            {resolveClipDisplayName({
              clip,
              isTextClip,
              isText3DClip,
              isMathSceneClip,
              text3DProperties,
            })}
          </span>
        </div>
        <span className="clip-duration">{formatTime(displayDuration)}</span>
      </div>
    </div>
  );
});
