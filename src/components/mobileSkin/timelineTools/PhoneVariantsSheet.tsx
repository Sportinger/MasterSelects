// 'variants' sheet (Timeline → Range → Compare alternatives, All tools): the editor's own storyboard
// variant comparison (StoryboardVariantComparisonTimelineDock, the desktop timeline's tray) inside a
// phone sheet. Options A/B/C switch the preview, play/scrub/loop stay synchronised, Accept commits
// the chosen option into the frozen range through commitTimelineVariantOption (one undo step; stale
// confirmations are refused by the editor and shown in the tray). Variant sets are made by the
// assistant, so with none open the sheet offers to ask it for alternatives of the marked range.

import { useStoryboardStore } from '../../../stores/storyboardStore';
import { useTimelineStore } from '../../../stores/timeline';
import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { StoryboardVariantComparisonTimelineDock } from '../../storyboard/variants';
import { openPhoneAssistantWithPrompt } from '../assistant/phoneAssistantPrefill';
import type { PhoneSheetComponent } from '../contracts';
import { ProButton, ProSection } from '../compositions/phoneProControls';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { formatPhoneRangeTime, phoneRangeSpan } from './phoneTimelinePrefs';
import { hasOpenPhoneVariantSet } from './phoneTimelineToolsModel';
import { PHONE_VARIANTS_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';
import './PhoneTimelineTools.css';

export const PhoneVariantsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const open = useStoryboardStore((state) => hasOpenPhoneVariantSet(state.variantSets));
  const inPoint = useTimelineStore((state) => state.inPoint);
  const outPoint = useTimelineStore((state) => state.outPoint);
  const duration = useTimelineStore((state) => state.duration);
  const fps = getActiveCompositionFrameRate();
  const span = phoneRangeSpan(inPoint, outPoint, duration);
  const rangeText = span ? `${formatPhoneRangeTime(span.start, fps)} to ${formatPhoneRangeTime(span.end, fps)}` : 'the whole composition';

  return (
    <PhoneSheet title="Compare alternatives" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-variants" data-testid={IDS.root} data-open={open ? 'true' : 'false'}>
        {open ? (
          <div data-testid={IDS.tray}>
            <StoryboardVariantComparisonTimelineDock />
          </div>
        ) : (
          <ProSection title="No alternatives yet">
            <p className="phone-tltools__summary" data-testid={IDS.empty}>
              Three versions (A, B, C) of a range are built by the assistant. Mark the range with In and Out, then ask it; the
              versions appear here to play side by side, and Accept puts the chosen one into your timeline as one undo step.
            </p>
            <ProButton
              label={`Ask for three versions of ${rangeText}`}
              tone="primary"
              testId={IDS.ask}
              onPress={() => openPhoneAssistantWithPrompt(`Make three storyboard variants (A, B, C) of the timeline range ${rangeText} so I can compare them.`)}
            />
          </ProSection>
        )}
      </div>
    </PhoneSheet>
  );
};
