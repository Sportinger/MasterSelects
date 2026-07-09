import type { ComponentProps, CSSProperties } from 'react';
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
      optionCount = parameterPopovers.durationOptions.length;
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
    case sunoPopovers.activePopover === 'sunoMode':
      optionCount = 4;
      break;
    case chatControls.renderedPopover === 'chatProvider':
      optionCount = chatControls.chatProviderOptions.length;
      break;
    case chatControls.renderedPopover === 'chatModel':
      optionCount = chatControls.chatModelOptions.length;
      break;
    case chatControls.renderedPopover === 'chatContext':
      optionCount = 8;
      break;
    case chatControls.renderedPopover === 'chatReasoning':
      optionCount = chatControls.chatReasoningEffortOptions.length;
      break;
    case chatControls.renderedPopover === 'chatTemperature':
      optionCount = 2;
      extraHeight = 38;
      break;
  }

  const estimatedRows = Math.max(1, Math.ceil(optionCount / 2));
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
    <div className={`fb-bubble-bar ${inlineSubmenuStateClassName}`} style={inlineSubmenuStyle}>
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
