import type { CatalogEntry } from '../../../services/flashboard/types';

interface FlashBoardComposerWarningsProps {
  audioValidationError: string | null;
  backendValidationError: string | null;
  chatPanelOpen: boolean;
  promptRefineError: string | null;
  seedanceReferenceValidationError: string | null;
  service: CatalogEntry['service'];
  onAuthClick: () => void;
  onPricingClick: () => void;
}

export function FlashBoardComposerWarnings({
  audioValidationError,
  backendValidationError,
  chatPanelOpen,
  promptRefineError,
  seedanceReferenceValidationError,
  service,
  onAuthClick,
  onPricingClick,
}: FlashBoardComposerWarningsProps) {
  if (chatPanelOpen) {
    return null;
  }

  const showGenerationCloudActions = Boolean(
    backendValidationError && service === 'cloud' && /sign in/i.test(backendValidationError),
  );

  return (
    <>
      {audioValidationError && (
        <div className="fb-audio-warning compact">{audioValidationError}</div>
      )}

      {seedanceReferenceValidationError && (
        <div className="fb-audio-warning compact">{seedanceReferenceValidationError}</div>
      )}

      {backendValidationError && (
        <div className={`fb-audio-warning compact ${showGenerationCloudActions ? 'has-cloud-actions' : ''}`}>
          <span>{backendValidationError}</span>
          {showGenerationCloudActions && (
            <div className="fb-cloud-warning-actions">
              <button type="button" onClick={onPricingClick}>
                Prices
              </button>
              <button type="button" onClick={onAuthClick}>
                Sign in
              </button>
            </div>
          )}
        </div>
      )}

      {promptRefineError && (
        <div className="fb-audio-warning compact">{promptRefineError}</div>
      )}
    </>
  );
}
