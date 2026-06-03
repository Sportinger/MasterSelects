import type { TimelineClip } from '../../../types';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';

export type ClipStaticIconKind = 'camera' | 'gaussian-splat' | 'model';

export interface ClipMediaClassification {
  isAudioClip: boolean;
  isTextClip: boolean;
  isText3DClip: boolean;
  isModelClip: boolean;
  isSolidClip: boolean;
  isMathSceneClip: boolean;
  isVectorAnimationClip: boolean;
  vectorAnimationIcon: string;
  vectorAnimationTitle: string;
  isCameraClip: boolean;
  isGaussianSplatClip: boolean;
  isSplatEffectorClip: boolean;
  staticClipIconKind: ClipStaticIconKind | null;
  showsStaticClipArtwork: boolean;
  text3DProperties: TimelineClip['text3DProperties'];
  clipTypeClass: string;
}

const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus']);

export function resolveClipMediaClassification(clip: TimelineClip): ClipMediaClassification {
  const sourceType = clip.source?.type;
  const fileExt = (clip.file?.name || clip.name || '').split('.').pop()?.toLowerCase() || '';
  const isAudioClip = sourceType === 'audio' ||
    clip.file?.type?.startsWith('audio/') ||
    AUDIO_EXTENSIONS.has(fileExt);
  const isTextClip = sourceType === 'text';
  const meshType = clip.meshType ?? clip.source?.meshType;
  const isText3DClip = sourceType === 'model' && meshType === 'text3d';
  const isModelClip = sourceType === 'model' && !isText3DClip;
  const text3DProperties = clip.text3DProperties ?? clip.source?.text3DProperties;
  const isSolidClip = sourceType === 'solid';
  const isMathSceneClip = sourceType === 'math-scene';
  const isVectorAnimationClip = isVectorAnimationSourceType(sourceType);
  const vectorAnimationIcon = sourceType === 'rive' ? 'R' : 'L';
  const vectorAnimationTitle = sourceType === 'rive' ? 'Rive Clip' : 'Lottie Clip';
  const isCameraClip = sourceType === 'camera';
  const isGaussianSplatClip = sourceType === 'gaussian-splat';
  const isSplatEffectorClip = sourceType === 'splat-effector';
  const staticClipIconKind: ClipStaticIconKind | null = isCameraClip
    ? 'camera'
    : isGaussianSplatClip
      ? 'gaussian-splat'
      : isModelClip
        ? 'model'
        : null;
  const clipTypeClass = isSolidClip
    ? 'solid'
    : isMathSceneClip
      ? 'math-scene'
      : (isTextClip || isText3DClip)
        ? 'text'
        : isCameraClip
          ? 'camera'
          : isSplatEffectorClip
            ? 'splat-effector'
            : isAudioClip
              ? 'audio'
              : (sourceType || 'video');

  return {
    isAudioClip,
    isTextClip,
    isText3DClip,
    isModelClip,
    isSolidClip,
    isMathSceneClip,
    isVectorAnimationClip,
    vectorAnimationIcon,
    vectorAnimationTitle,
    isCameraClip,
    isGaussianSplatClip,
    isSplatEffectorClip,
    staticClipIconKind,
    showsStaticClipArtwork: staticClipIconKind !== null,
    text3DProperties,
    clipTypeClass,
  };
}
