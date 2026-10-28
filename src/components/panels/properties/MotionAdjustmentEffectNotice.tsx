import { useMemo } from 'react';
import type { Effect } from '../../../types/effects';
import { classifyAdjustmentEffect } from '../../../services/motionDesign/adjustment/adjustmentEffectClassification';
import { admitAdjustmentEffectsForRender } from '../../../services/motionDesign/adjustment/adjustmentEffectRenderAdmission';

type NoticeEffect = Pick<Effect, 'id' | 'name' | 'enabled' | 'params' | 'operatorGraph'> & { type: string };

/**
 * Card notice on an adjustment layer's effect: why it is bypassed (cannot run on an adjustment
 * layer, malformed data) or which values of the wrong type render with their default. Silent when it
 * renders as set (a number outside its rendered range is named by the effect card itself).
 */
export function MotionAdjustmentEffectNotice({ clipId, effect }: { clipId: string; effect: NoticeEffect }) {
  const messages = useMemo(() => {
    const classification = classifyAdjustmentEffect(effect.type);
    if (!classification.admitted && effect.type !== 'blur') {
      return { bypassed: true, lines: [`${classification.reason} It is bypassed; the rest of the layer renders.`] };
    }
    const admission = admitAdjustmentEffectsForRender(clipId, [{ ...effect, type: effect.type as Effect['type'], enabled: true }]);
    if (admission.bypassed.length) {
      return { bypassed: true, lines: admission.bypassed.map((item) => `${item.reason} It is bypassed; the rest of the layer renders.`) };
    }
    return { bypassed: false, lines: admission.adjusted.map((item) => item.message) };
  }, [clipId, effect]);
  if (messages.lines.length === 0) return null;
  return (
    <div className="effect-quality-warning" role="status" data-testid="motion-adjustment-effect-notice"
      data-bypassed={messages.bypassed ? 'true' : 'false'}>
      {messages.lines.join(' ')}
    </div>
  );
}
