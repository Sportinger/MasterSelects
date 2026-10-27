// Timeline variants in the phone assistant: when the assistant built alternative versions of a range
// (createTimelineVariantSet and friends), the editor's own comparison tray shows here: watch A, B or C
// (each opens its variant composition; the original edit is untouched), keep one (the editor's
// commitTimelineVariantOption, refused if the original changed meanwhile, and undoable) or reject it.
// Without a variant set, one tap types a request for three versions into the field (never sent).
import { StoryboardVariantComparisonTimelineDock } from '../../storyboard/variants';
import { PHONE_ASSISTANT_VARIANTS_TEST_IDS, PHONE_VARIANTS_PROMPT } from './phoneAssistantTestIds';
import { usePhoneReviewVariantSetId } from './usePhoneReviewVariantSetId';

export function PhoneAssistantVariants({ onAsk, disabled }: { onAsk: (prompt: string) => void; disabled: boolean }) {
  const setId = usePhoneReviewVariantSetId();
  const ids = PHONE_ASSISTANT_VARIANTS_TEST_IDS;
  if (setId) {
    return (
      <section className="phone-assistant__variants" data-testid={ids.root} data-variant-set={setId} aria-label="Compare versions">
        <StoryboardVariantComparisonTimelineDock />
      </section>
    );
  }
  return (
    <section className="phone-assistant__variants phone-assistant__variants--empty" data-testid={ids.root} data-variant-set="" aria-label="Compare versions">
      <button type="button" className="phone-assistant__variants-ask" data-testid={ids.ask} aria-disabled={disabled}
        onPointerUp={(event) => event.currentTarget.blur()}
        onClick={() => { if (!disabled) onAsk(PHONE_VARIANTS_PROMPT); }}>
        Compare three versions (A/B/C)
      </button>
    </section>
  );
}
