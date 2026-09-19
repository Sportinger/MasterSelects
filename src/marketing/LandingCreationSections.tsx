import { IconPlus } from '@tabler/icons-react';

import type { useSeedancePreproductionController } from './useSeedancePreproductionController';
import { LandingEditReview } from './LandingEditReview';
import { LandingReviewConversation } from './LandingReviewConversation';
import { SeedancePreproductionWizard } from './SeedancePreproductionWizard';
import type { LandingPageProps, LandingPromptPath } from './LandingPageProps';

export { LandingSequenceSelector } from './LandingSequenceSelector';

interface LandingChatHeadingProps {
  isNewProjectNaming: boolean;
  isSubmitting: boolean;
  directAvailable: boolean;
  onCancelNewProjectNaming?: () => void;
  onPromptPathChange: (path: LandingPromptPath) => void;
  promptPath: LandingPromptPath;
}

export function LandingChatHeading({
  isNewProjectNaming,
  isSubmitting,
  directAvailable,
  onCancelNewProjectNaming,
  onPromptPathChange,
  promptPath,
}: LandingChatHeadingProps) {
  return (
    <div className="landing-chat-heading-row">
      <p className="landing-eyebrow" id="landing-chat-heading">
        {isNewProjectNaming ? 'New project' : 'Start with AI'}
      </p>
      {isNewProjectNaming ? (
        <button
          className="landing-project-naming-cancel"
          type="button"
          disabled={isSubmitting}
          onClick={onCancelNewProjectNaming}
        >
          Cancel <kbd>Esc</kbd>
        </button>
      ) : (
        <div className="landing-prompt-path" role="group" aria-label="Prompt path">
          {directAvailable && <button
            aria-pressed={promptPath === 'direct'}
            className={promptPath === 'direct' ? 'is-active' : ''}
            type="button"
            onClick={() => onPromptPathChange('direct')}
          >
            <strong>Direkt</strong>
          </button>}
          <button
            aria-pressed={promptPath === 'auto'}
            className={promptPath === 'auto' ? 'is-active' : ''}
            type="button"
            title="Automatic editing"
            onClick={() => onPromptPathChange('auto')}
          >
            <strong>Auto</strong>
          </button>
          <button
            aria-pressed={promptPath === 'story'}
            className={promptPath === 'story' ? 'is-active' : ''}
            type="button"
            title="Preproduction + image anchors"
            onClick={() => onPromptPathChange('story')}
          >
            <strong>Story</strong>
          </button>
        </div>
      )}
    </div>
  );
}

export function LandingReviewPromptModeToggle({
  disabled,
  mode,
  onChange,
}: {
  disabled: boolean;
  mode: 'revise' | 'variant';
  onChange: (mode: 'revise' | 'variant') => void;
}) {
  return (
    <div className="landing-review-prompt-mode" aria-label="AI edit target">
      <button aria-pressed={mode === 'revise'} className={mode === 'revise' ? 'is-active' : ''} disabled={disabled} type="button" onClick={() => onChange('revise')}>
        Edit selected version
      </button>
      <button aria-pressed={mode === 'variant'} className={mode === 'variant' ? 'is-active' : ''} disabled={disabled} type="button" onClick={() => onChange('variant')}>
        <IconPlus aria-hidden="true" /> New version
      </button>
    </div>
  );
}

type SeedanceController = ReturnType<typeof useSeedancePreproductionController>;

interface LandingCreationResultsProps {
  isChatBusy: boolean;
  onOpenEditor?: () => void;
  onRenderVideo?: () => Promise<void> | void;
  onSelectReviewVariant?: LandingPageProps['onSelectReviewVariant'];
  onSelectReviewInputOption?: (prompt: string) => void;
  reviewActiveVariantId?: string;
  reviewCompositionId?: string;
  reviewCompositionName?: string;
  reviewError?: string;
  reviewMessages: NonNullable<LandingPageProps['reviewMessages']>;
  reviewReady: boolean;
  reviewRendering: boolean;
  reviewVariants: NonNullable<LandingPageProps['reviewVariants']>;
  selectedSequence?: NonNullable<LandingPageProps['sequences']>[number];
  selectedSequenceReady: boolean;
  seedance: SeedanceController;
  seedanceEnabled: boolean;
}

export function LandingCreationResults({
  isChatBusy,
  onOpenEditor,
  onRenderVideo,
  onSelectReviewVariant,
  onSelectReviewInputOption,
  reviewActiveVariantId,
  reviewCompositionId,
  reviewCompositionName,
  reviewError,
  reviewMessages,
  reviewReady,
  reviewRendering,
  reviewVariants,
  selectedSequence,
  selectedSequenceReady,
  seedance,
  seedanceEnabled,
}: LandingCreationResultsProps) {
  return (
    <>
      {reviewReady && !seedanceEnabled && onRenderVideo && (
        <>
          <LandingReviewConversation
            disabled={isChatBusy}
            messages={reviewMessages}
            onSelectInputOption={onSelectReviewInputOption}
          />
          <LandingEditReview
            activeVariantId={reviewActiveVariantId}
            compositionId={reviewCompositionId}
            compositionName={reviewCompositionName}
            error={reviewError}
            isRendering={reviewRendering}
            onOpenEditor={onOpenEditor}
            onRender={onRenderVideo}
            onSelectVariant={onSelectReviewVariant}
            variants={reviewVariants}
          />
        </>
      )}
      {!reviewReady && selectedSequenceReady && selectedSequence && !seedanceEnabled && (
        <LandingEditReview
          compositionId={selectedSequence.id}
          compositionName={selectedSequence.name}
          onOpenEditor={onOpenEditor}
          presentation="sequence"
        />
      )}
      {seedanceEnabled && seedance.run && (
        <SeedancePreproductionWizard
          chooseIdea={seedance.chooseIdea}
          chooseMaster={seedance.chooseMaster}
          continueFromMedia={seedance.continueFromMedia}
          moreIdeas={seedance.moreIdeas}
          onOpenEditor={onOpenEditor}
          readyKeyframeCount={seedance.readyKeyframeCount}
          regenerateMasters={seedance.regenerateMasters}
          regenerateSelected={seedance.regenerateSelected}
          replanAssets={seedance.replanAssets}
          retrySourceResearch={seedance.retrySourceResearch}
          resume={seedance.resume}
          reset={seedance.reset}
          run={seedance.run}
          setSceneExpanded={seedance.setSceneExpanded}
          setStoryExpanded={seedance.setStoryExpanded}
          toggleKeyframe={seedance.toggleKeyframe}
          toggleSourceAsset={seedance.toggleSourceAsset}
        />
      )}
    </>
  );
}
