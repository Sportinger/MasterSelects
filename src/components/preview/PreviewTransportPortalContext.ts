import { createContext, useContext } from 'react';

interface PreviewTransportPortalContextValue {
  externalSourceControls: boolean;
  sourceControlsTarget: HTMLDivElement | null;
  setSourceControlsTarget: (target: HTMLDivElement | null) => void;
}

const DEFAULT_PREVIEW_TRANSPORT_PORTAL_CONTEXT: PreviewTransportPortalContextValue = {
  externalSourceControls: false,
  sourceControlsTarget: null,
  setSourceControlsTarget: () => undefined,
};

export const PreviewTransportPortalContext = createContext<PreviewTransportPortalContextValue>(
  DEFAULT_PREVIEW_TRANSPORT_PORTAL_CONTEXT,
);

export function usePreviewTransportPortal(): PreviewTransportPortalContextValue {
  return useContext(PreviewTransportPortalContext);
}
