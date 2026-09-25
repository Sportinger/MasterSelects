import type { FullscreenEffectDefinition } from '../../types';
import { slitScanParams } from './parameters';

/** The editable Image IR group owns rendering; there is no parallel effect shader. */
export const slitScan: FullscreenEffectDefinition = {
  id: 'slit-scan', name: 'Slit Scan', category: 'time',
  shader: '// Rendered by the editable Slit Scan Image IR group.', entryPoint: 'slitScanFragment', uniformSize: 0,
  usesInputHistory: true, sourceTimeOwner: 'slit-scan', params: slitScanParams, packUniforms: () => null,
};
