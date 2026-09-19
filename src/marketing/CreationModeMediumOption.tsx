import { forwardRef, type MouseEventHandler } from 'react';
import {
  IconAdjustmentsHorizontal,
  IconArrowUpRight,
} from '@tabler/icons-react';

interface CreationModeMediumOptionProps {
  href: string;
  onClick: MouseEventHandler<HTMLAnchorElement>;
  tabIndex?: number;
}

export const CreationModeMediumOption = forwardRef<
  HTMLAnchorElement,
  CreationModeMediumOptionProps
>(function CreationModeMediumOption({ href, onClick, tabIndex }, ref) {
  return (
    <a
      ref={ref}
      className="creation-mode-option creation-mode-option--medium"
      href={href}
      onClick={onClick}
      aria-describedby="creation-mode-medium-description"
      tabIndex={tabIndex}
    >
      <span className="creation-mode-option-topline">
        <span className="creation-mode-piece creation-mode-option-index">02</span>
        <IconAdjustmentsHorizontal
          className="creation-mode-piece creation-mode-option-icon"
          aria-hidden="true"
        />
      </span>
      <span className="creation-mode-option-copy">
        <strong className="creation-mode-piece creation-mode-option-title">MEDIUM</strong>
        <span
          className="creation-mode-piece creation-mode-option-description"
          id="creation-mode-medium-description"
        >
          Guide the AI, then refine the result with hands-on editing.
        </span>
      </span>
      <span className="creation-mode-hybrid-preview" aria-hidden="true">
        <span className="creation-mode-hybrid-prompt"><i /><i /><i /></span>
        <span className="creation-mode-hybrid-bridge"><i /></span>
        <span className="creation-mode-hybrid-timeline">
          <i><b /><b /></i>
          <i><b /><b /><b /></i>
        </span>
      </span>
      <span className="creation-mode-option-action">
        <span className="creation-mode-piece creation-mode-option-access-label">
          <span className="creation-mode-option-access-copy">
            Available via <strong className="creation-mode-option-access-channel">AI + MCP</strong>
          </span>
          <span className="creation-mode-option-access-shine" aria-hidden="true">
            Available via <strong className="creation-mode-option-access-channel">AI + MCP</strong>
          </span>
        </span>
        <span className="creation-mode-piece creation-mode-option-action-label">
          Create &amp; refine
        </span>
        <IconArrowUpRight
          className="creation-mode-piece creation-mode-option-arrow"
          aria-hidden="true"
        />
      </span>
    </a>
  );
});
