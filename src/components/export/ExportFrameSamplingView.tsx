import type { ExportFrameSampling } from '../../engine/export/types';
import './ExportFrameSamplingView.css';

const STAGES: Array<{ key: ExportFrameSampling['stage']; label: string }> = [
  { key: 'sampling', label: 'Samples' },
  { key: 'denoising', label: 'Denoise' },
  { key: 'encoding', label: 'Encode' },
];

/** Second progress level of a path traced export: the current frame's samples, then denoise and encode. */
export function ExportFrameSamplingView({ sampling }: { sampling: ExportFrameSampling }) {
  const denoise = sampling.denoiseEnabled || sampling.stage === 'denoising';
  if (sampling.targetSamples <= 1 && !denoise) return null;
  const stages = STAGES.filter(stage => stage.key !== 'denoising' || denoise);
  const current = stages.findIndex(stage => stage.key === sampling.stage);
  const fraction = sampling.stage === 'sampling' ? sampling.samples / Math.max(1, sampling.targetSamples) : 1;
  return (
    <div className="export-frame-sampling" aria-label="Current frame progress">
      <div className="export-frame-sampling-stages">
        {stages.map((stage, index) => (
          <span key={stage.key} className={`export-frame-sampling-stage${index === current ? ' active' : index < current ? ' done' : ''}`}>
            {stage.key === 'sampling' ? `${stage.label} ${sampling.samples} / ${sampling.targetSamples}` : stage.label}
          </span>
        ))}
      </div>
      <div className="export-frame-sampling-bar" role="progressbar" aria-label="Frame samples" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}>
        <div className="export-frame-sampling-fill" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
      </div>
    </div>
  );
}
