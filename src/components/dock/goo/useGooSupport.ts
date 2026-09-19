import { useEffect, useState } from 'react';

import { acquireGooRenderer } from './gooRenderer';

let webglProbe: boolean | null = null;

// Decides whether the metaball drag overlay can run; otherwise the plain
// chip preview stays. WebGL is probed lazily on the first drag so app
// startup never pays for an extra GL context.
export function useGooSupport(isDragging: boolean): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  const [webglOk, setWebglOk] = useState(webglProbe === true);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setReducedMotion(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isDragging || webglProbe !== null || reducedMotion) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      webglProbe = acquireGooRenderer() !== null;
      setWebglOk(webglProbe);
    });
    return () => { cancelled = true; };
  }, [isDragging, reducedMotion]);

  return webglOk && !reducedMotion;
}
