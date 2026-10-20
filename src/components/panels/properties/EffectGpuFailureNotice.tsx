import { useSyncExternalStore } from 'react';
import { getEffectGpuFailure, subscribeEffectGpuFailures } from '../../../effects/effectGpuFailures';

/** Shown when this device's GPU could not build the effect, which is then skipped. */
export function EffectGpuFailureNotice({ effectType }: { effectType: string }) {
  const failure = useSyncExternalStore(subscribeEffectGpuFailures, () => getEffectGpuFailure(effectType));
  if (!failure) return null;
  return <div className="effect-quality-warning effect-gpu-failure" role="status" title={failure}>
    This device&apos;s graphics driver could not build this effect, so it is skipped. Other effects keep rendering.
  </div>;
}
