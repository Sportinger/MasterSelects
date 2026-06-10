import type { ComponentProps } from 'react';
import { FlashBoardActionStack } from './FlashBoardActionStack';
import { FlashBoardChatControls } from './FlashBoardChatControls';
import { FlashBoardElevenLabsSettingsPopovers } from './FlashBoardElevenLabsSettingsPopovers';
import { FlashBoardElevenLabsVoicePopover } from './FlashBoardElevenLabsVoicePopover';
import { FlashBoardGenerationControls } from './FlashBoardGenerationControls';
import { FlashBoardModelPopover } from './FlashBoardModelPopover';
import { FlashBoardParameterPopovers } from './FlashBoardParameterPopovers';
import { FlashBoardSunoPopovers } from './FlashBoardSunoPopovers';

interface FlashBoardComposerControlBarProps {
  actionStack: ComponentProps<typeof FlashBoardActionStack>;
  chatControls: ComponentProps<typeof FlashBoardChatControls>;
  chatPanelOpen: boolean;
  elevenLabsSettingsPopovers: ComponentProps<typeof FlashBoardElevenLabsSettingsPopovers>;
  elevenLabsVoicePopover: ComponentProps<typeof FlashBoardElevenLabsVoicePopover>;
  generationControls: Omit<ComponentProps<typeof FlashBoardGenerationControls>, 'children'>;
  inlineSubmenuStateClassName: string;
  modelPopover: ComponentProps<typeof FlashBoardModelPopover>;
  parameterPopovers: ComponentProps<typeof FlashBoardParameterPopovers>;
  sunoPopovers: ComponentProps<typeof FlashBoardSunoPopovers>;
}

export function FlashBoardComposerControlBar({
  actionStack,
  chatControls,
  chatPanelOpen,
  elevenLabsSettingsPopovers,
  elevenLabsVoicePopover,
  generationControls,
  inlineSubmenuStateClassName,
  modelPopover,
  parameterPopovers,
  sunoPopovers,
}: FlashBoardComposerControlBarProps) {
  return (
    <div className={`fb-bubble-bar ${inlineSubmenuStateClassName}`}>
      {!chatPanelOpen && (
        <FlashBoardGenerationControls {...generationControls}>
          <FlashBoardModelPopover {...modelPopover} />
          <FlashBoardSunoPopovers {...sunoPopovers} />
          <FlashBoardElevenLabsSettingsPopovers {...elevenLabsSettingsPopovers} />
          <FlashBoardElevenLabsVoicePopover {...elevenLabsVoicePopover} />
          <FlashBoardParameterPopovers {...parameterPopovers} />
        </FlashBoardGenerationControls>
      )}

      {chatPanelOpen && <FlashBoardChatControls {...chatControls} />}

      <FlashBoardActionStack {...actionStack} />
    </div>
  );
}
