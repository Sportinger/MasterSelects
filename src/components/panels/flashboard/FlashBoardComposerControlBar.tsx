import type { ComponentProps, CSSProperties } from 'react';
import { FlashBoardActionStack } from './FlashBoardActionStack';
import {
  FLASHBOARD_CHAT_MODEL_CLASS_OPTION_COUNT,
  FlashBoardChatControls,
} from './FlashBoardChatControls';
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

type InlineSubmenuStyle = CSSProperties & {
  '--fb-inline-submenu-height'?: string;
};

function getInlineSubmenuStyle(
  inlineSubmenuStateClassName: string,
  modelPopover: ComponentProps<typeof FlashBoardModelPopover>,
  parameterPopovers: ComponentProps<typeof FlashBoardParameterPopovers>,
  sunoPopovers: ComponentProps<typeof FlashBoardSunoPopovers>,
  chatControls: ComponentProps<typeof FlashBoardChatControls>
): InlineSubmenuStyle | undefined {
  if (!inlineSubmenuStateClassName) {
    return undefined;
  }

  let optionCount = 1;
  let columnCount = 2;
  let extraHeight = 8;

  switch (true) {
    case modelPopover.activePopover === 'model':
      optionCount = modelPopover.entries.length;
      extraHeight = 34;
      break;
    case parameterPopovers.activePopover === 'aspect':
      optionCount = parameterPopovers.aspectOptions.length;
      break;
    case parameterPopovers.activePopover === 'duration':
      optionCount = parameterPopovers.durationRange ? 2 : parameterPopovers.durationOptions.length;
      if (parameterPopovers.durationRange) extraHeight = 34;
      break;
    case parameterPopovers.activePopover === 'imageSize':
      optionCount = parameterPopovers.imageSizeOptions.length;
      break;
    case parameterPopovers.activePopover === 'mode':
      optionCount = parameterPopovers.modeOptions.length;
      break;
    case sunoPopovers.activePopover === 'sunoModel':
      optionCount = sunoPopovers.modelOptions.length;
      break;
    case chatControls.renderedPopover === 'chatProvider':
      optionCount = chatControls.chatProviderOptions.length;
      break;
    case chatControls.renderedPopover === 'chatModelClass':
      optionCount = FLASHBOARD_CHAT_MODEL_CLASS_OPTION_COUNT;
      columnCount = FLASHBOARD_CHAT_MODEL_CLASS_OPTION_COUNT;
      break;
  }

  const estimatedRows = Math.max(1, Math.ceil(optionCount / columnCount));
  const height = extraHeight + estimatedRows * 28;
  return { '--fb-inline-submenu-height': `${height}px` };
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
  const inlineSubmenuStyle = getInlineSubmenuStyle(
    inlineSubmenuStateClassName,
    modelPopover,
    parameterPopovers,
    sunoPopovers,
    chatControls,
  );

  return (
    <div
      className={`fb-bubble-bar ${chatPanelOpen ? 'is-chat-mode' : ''} ${inlineSubmenuStateClassName}`}
      style={inlineSubmenuStyle}
    >
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
