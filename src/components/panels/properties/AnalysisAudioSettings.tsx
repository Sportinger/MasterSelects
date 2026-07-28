import { IconWaveSine } from '@tabler/icons-react';
import type { AnalysisAudioFeatureStatus, AnalysisAudioIntelligenceStatus } from './useAnalysisAudioIntelligence';

interface AnalysisAudioSettingsProps {
  hasAudio: boolean;
  status: AnalysisAudioIntelligenceStatus;
  features: readonly AnalysisAudioFeatureStatus[];
  running: boolean;
  progress: number;
  onRun: () => void;
  onCancel: () => void;
}

function artifactAge(createdAt: number | undefined): string {
  if (createdAt === undefined) return 'absent';
  const elapsed = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'present, just now';
  if (minutes < 60) return `present, ${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `present, ${hours}h old`;
  return `present, ${Math.floor(hours / 24)}d old`;
}

export function AnalysisAudioSettings({
  hasAudio, status, features, running, progress, onRun, onCancel,
}: AnalysisAudioSettingsProps) {
  if (!hasAudio) return null;
  return (
    <section className='analysis-settings-area' aria-label='Audio intelligence settings'>
      <h5 className='analysis-settings-area__title'>
        <IconWaveSine aria-hidden='true' size={14} stroke={1.9} />
        <span>Audio intelligence</span>
      </h5>
      <div className='analysis-configuration__groups'>
        {features.map(feature => (
          <div className='analysis-choice-group' key={feature.id}>
            <span className='analysis-choice-group__label'>{feature.label}</span>
            <span>{artifactAge(feature.createdAt)}</span>
          </div>
        ))}
        <button type='button' className='analysis-choice' onClick={running ? onCancel : onRun}>
          {running ? `Cancel (${Math.round(progress)}%)` : status === 'none' ? 'Run' : 'Re-run'}
        </button>
      </div>
    </section>
  );
}
