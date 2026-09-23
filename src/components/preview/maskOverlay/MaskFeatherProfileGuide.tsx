import { useId } from 'react';
import { maskFeatherGuideAlpha } from '../../../utils/maskFeatherProfile';

/** Shows the transition around the shifted contour without moving the editable path. */
export function MaskFeatherProfileGuide({ path, width, height, feather, offset, balance }: {
  path: string; width: number; height: number; feather: number; offset: number; balance: number;
}) {
  const id = useId().replace(/:/g, ''), filter = `feather-profile-${id}`, mask = `feather-contour-${id}`;
  const padding = Math.abs(offset) + Math.max(1, feather) * 4;
  const bounds = { x: -padding, y: -padding, width: width + padding * 2, height: height + padding * 2 };
  const curve = Array.from({ length: 257 }, (_, i) => maskFeatherGuideAlpha(i / 256, balance)).join(' ');
  return <g>
    <defs>
      <mask id={mask} maskUnits="userSpaceOnUse" {...bounds} style={{ maskType: 'luminance' }}>
        <path d={path} fill="white" stroke={offset >= 0 ? 'white' : 'black'} strokeWidth={2 * Math.abs(offset)} strokeLinejoin="round" strokeLinecap="round" />
      </mask>
      <filter id={filter} filterUnits="userSpaceOnUse" {...bounds} colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={Math.max(.5, feather)} />
        {/* Discrete buckets keep the inner boundary crisp instead of fading back to zero. */}
        <feComponentTransfer><feFuncA type="discrete" tableValues={curve} /></feComponentTransfer>
      </filter>
    </defs>
    <g filter={`url(#${filter})`}><rect {...bounds} fill="red" mask={`url(#${mask})`} /></g>
  </g>;
}
