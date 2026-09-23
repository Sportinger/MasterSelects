import type { ClipPropertiesPresentation, PropertiesTab } from './propertiesPanelTypes';

/** A clip switch keeps the inspector page only when the next clip exposes it. */
export function canKeepClipPropertiesTab(tab: PropertiesTab, clip: ClipPropertiesPresentation): boolean {
  const { isStoryboardClip, isAudioClip, isCameraClip, isFlockClip, isMathSceneClip,
    isMotionAdjustmentClip, isMotionShapeClip, isCaptionClip, isTextClip, is3DTextClip,
    isSolidClip, isVectorAnimationClip, isLightClip, isSplatEffectorClip, isModelClip,
    isGaussianAvatar, isGaussianSplat, isEditableHookClip } = clip;
  switch (tab) {
    case 'storyboard': return isStoryboardClip;
    case 'effects': return !isStoryboardClip && !isCameraClip && !isFlockClip && !isLightClip;
    case 'transform': return !isStoryboardClip && !isAudioClip && !isMotionAdjustmentClip;
    case 'color': return !isStoryboardClip && !isAudioClip && !isCameraClip && !isFlockClip
      && !isMotionAdjustmentClip && !isLightClip && !isSplatEffectorClip;
    case 'masks': return !isStoryboardClip && !isAudioClip && !isCameraClip && !isFlockClip && !isLightClip;
    case 'analysis': return isAudioClip || (!isStoryboardClip && !isCameraClip && !isFlockClip
      && !isMathSceneClip && !isMotionAdjustmentClip && !isMotionShapeClip && !isCaptionClip
      && !isTextClip && !is3DTextClip && !isSolidClip && !isVectorAnimationClip && !isLightClip);
    case 'tracking': return !isStoryboardClip && !isAudioClip && !isCameraClip && !isFlockClip
      && !isMathSceneClip && !isMotionAdjustmentClip && !isModelClip && !is3DTextClip
      && !isGaussianAvatar && !isGaussianSplat && !isLightClip && !isSplatEffectorClip;
    case 'audio-edits': return isAudioClip;
    case 'hook': return isEditableHookClip && (isMotionShapeClip || isTextClip);
    case 'text': return isTextClip;
    case 'captions': return isCaptionClip;
    case '3d-text': return is3DTextClip;
    case 'model-3d': return isModelClip;
    case 'math': return isMathSceneClip;
    case 'flock': return isFlockClip;
    case 'motion': return isMotionShapeClip;
    case 'adjustment': return isMotionAdjustmentClip;
    case 'blendshapes': return isGaussianAvatar;
    case 'gaussian-splat': return isGaussianSplat;
    case 'light': return isLightClip;
    case 'splat-effector': return isSplatEffectorClip;
    case 'lottie': return isVectorAnimationClip;
    default: return false;
  }
}
