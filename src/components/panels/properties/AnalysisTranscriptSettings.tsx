import { IconFileText } from '@tabler/icons-react';
import type { TranscriptStatus } from '../../../types/clipMetadata';
import { TranscriptWorkspaceHeader } from './TranscriptWorkspaceHeader';
import type { TranscriptWorkspaceController } from './useTranscriptWorkspaceController';

interface AnalysisTranscriptSettingsProps {
  controller: TranscriptWorkspaceController;
  transcriptCount: number;
  transcriptProgress: number;
  transcriptStatus: TranscriptStatus;
}

export function AnalysisTranscriptSettings({
  controller,
  transcriptCount,
  transcriptProgress,
  transcriptStatus,
}: AnalysisTranscriptSettingsProps) {
  return (
    <section className="analysis-settings-area" aria-label="Transcript settings">
      <h5 className="analysis-settings-area__title">
        <IconFileText aria-hidden="true" size={14} stroke={1.9} />
        <span>Transcript</span>
      </h5>
      <TranscriptWorkspaceHeader
        activeProvider={controller.activeProvider}
        clipCoverage={controller.clipCoverage}
        hasTranscript={transcriptCount > 0}
        isPartial={controller.isPartial}
        isSignedIn={controller.isSignedIn}
        language={controller.language}
        onCancel={controller.onCancel}
        onContinue={controller.onContinue}
        onDelete={controller.onClear}
        onLanguageChange={controller.onLanguageChange}
        onProviderChange={controller.onProviderChange}
        onSearchChange={controller.onSearchChange}
        onTranscribe={controller.onTranscribe}
        run={controller.run}
        searchQuery={controller.searchQuery}
        settingsMode
        summary={controller.summary}
        transcriptProgress={transcriptProgress}
        transcriptStatus={transcriptStatus}
      />
    </section>
  );
}
