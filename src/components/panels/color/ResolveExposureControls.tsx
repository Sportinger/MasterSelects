import {
  ResolveParameterControl,
  type ResolveParameterBindings,
  type ResolveParameterConfig,
} from './ResolveParameterControl';
import './ResolveExposureControls.css';

// Exposure in stops; black and white points on the 0-100 signal scale.
const EXPOSURE_CONTROLS: ResolveParameterConfig[] = [
  { key: 'exposure', label: 'Exposure', decimals: 2, tone: 'highlight' },
  { key: 'blackPoint', label: 'Black Point', decimals: 2, scale: 100, tone: 'neutral-dark' },
  { key: 'whitePoint', label: 'White Point', decimals: 2, scale: 100, tone: 'highlight' },
];

export function ResolveExposureControls(bindings: ResolveParameterBindings) {
  return (
    <div className="resolve-exposure">
      <div className="resolve-exposure-row">
        {EXPOSURE_CONTROLS.map(config => (
          <ResolveParameterControl config={config} key={config.label} keyframes {...bindings} />
        ))}
      </div>
    </div>
  );
}
