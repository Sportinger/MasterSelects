import { renderDirectionalWipePreview } from './previews/directionalWipePreview';
import { renderDissolveDipPreview } from './previews/dissolveDipPreview';
import { renderGeometricWipePreview } from './previews/geometricWipePreview';
import { renderGlitchMotionPreview } from './previews/glitchMotionPreview';
import { renderIrisPreview } from './previews/irisPreview';
import { renderLightPreview } from './previews/lightPreview';
import { renderMovePreview } from './previews/movePreview';
import { renderPatternPreview } from './previews/patternPreview';
import type { TransitionPreviewRenderer } from './previews/previewShared';
import { renderRotate3dPreview } from './previews/rotate3dPreview';
import { renderStylizeZoomPreview } from './previews/stylizeZoomPreview';

export const TRANSITION_PREVIEW_RENDERERS: readonly TransitionPreviewRenderer[] = [
  renderDissolveDipPreview,
  renderDirectionalWipePreview,
  renderGeometricWipePreview,
  renderMovePreview,
  renderIrisPreview,
  renderLightPreview,
  renderGlitchMotionPreview,
  renderPatternPreview,
  renderStylizeZoomPreview,
  renderRotate3dPreview,
];
