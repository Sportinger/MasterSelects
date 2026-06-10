import type { ComponentProps } from 'react';
import { FlashBoardChatOutput } from './FlashBoardChatOutput';
import { FlashBoardMultishotPanel } from './FlashBoardMultishotPanel';
import { FlashBoardPromptEditor } from './FlashBoardPromptEditor';
import { FlashBoardReferenceStrip } from './FlashBoardReferenceStrip';

interface FlashBoardComposerMainSectionProps {
  chatOutput: ComponentProps<typeof FlashBoardChatOutput>;
  chatPanelOpen: boolean;
  multishotPanel: ComponentProps<typeof FlashBoardMultishotPanel>;
  promptEditor: ComponentProps<typeof FlashBoardPromptEditor>;
  referenceStrip: ComponentProps<typeof FlashBoardReferenceStrip>;
  showComposerReferences: boolean;
  showMultiShotPanel: boolean;
}

export function FlashBoardComposerMainSection({
  chatOutput,
  chatPanelOpen,
  multishotPanel,
  promptEditor,
  referenceStrip,
  showComposerReferences,
  showMultiShotPanel,
}: FlashBoardComposerMainSectionProps) {
  return (
    <>
      {chatPanelOpen && <FlashBoardChatOutput {...chatOutput} />}

      <div className={`fb-bubble-main ${showComposerReferences ? 'has-references' : ''}`}>
        {showComposerReferences && <FlashBoardReferenceStrip {...referenceStrip} />}
        <FlashBoardPromptEditor {...promptEditor} />
      </div>

      {showMultiShotPanel && <FlashBoardMultishotPanel {...multishotPanel} />}
    </>
  );
}
