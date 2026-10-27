import { useRef, type ReactNode } from 'react';
import { PhoneContextToolbar } from './PhoneContextToolbar';
import { PhoneToast } from './PhoneToast';
import { PhoneTopBar } from './PhoneTopBar';
import { PhoneTransport } from './PhoneTransport';
import { PhoneUnavailableNotice } from './PhoneUnavailableNotice';
import { PhoneWorkspaceHost } from '../workspace/PhoneWorkspace';
import { usePhoneViewport } from './usePhoneViewport';
import './PhoneShell.css';

/** Five strips: top bar, preview, transport, timeline, context toolbar. */
export function PhoneShell({ preview, timeline }: { preview: ReactNode; timeline: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePhoneViewport(rootRef);

  return (
    <div ref={rootRef} className="phone-shell" data-touch-goo="off">
      <PhoneTopBar />
      <section className="phone-shell__preview" aria-label="Preview area">
        {preview}
      </section>
      <PhoneTransport />
      <section className="phone-shell__timeline" aria-label="Timeline area">
        {timeline}
      </section>
      <PhoneContextToolbar />
      <PhoneWorkspaceHost />
      <PhoneUnavailableNotice />
      <PhoneToast />
    </div>
  );
}
