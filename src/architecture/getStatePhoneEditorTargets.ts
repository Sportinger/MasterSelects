// Phone editor (/m) action-time reads: edit commands, gestures, export and project commands read
// fresh store state when the user acts. Explicit hard targets, so growth stays visible.
export const phoneEditorGetStateHardTargets = [
  { path: 'src/components/mobileSkin/PhoneApp.tsx', maxCurrentHits: 1 },
  { path: 'src/components/mobileSkin/actions/phoneActionCatalog.ts', maxCurrentHits: 2 },
  { path: 'src/components/mobileSkin/actions/phoneClipEditActions.ts', maxCurrentHits: 12 },
  { path: 'src/components/mobileSkin/actions/phoneCutActions.ts', maxCurrentHits: 2 },
  { path: 'src/components/mobileSkin/assistant/PhoneAssistantSheet.tsx', maxCurrentHits: 1 },
  { path: 'src/components/mobileSkin/export/usePhoneExport.ts', maxCurrentHits: 5 },
  { path: 'src/components/mobileSkin/media/phoneMediaPlacement.ts', maxCurrentHits: 5 },
  { path: 'src/components/mobileSkin/media/usePhoneMediaImport.ts', maxCurrentHits: 1 },
  { path: 'src/components/mobileSkin/project/usePhoneProjectCommands.ts', maxCurrentHits: 3 },
  { path: 'src/components/mobileSkin/runtime/PhoneRuntimeHost.tsx', maxCurrentHits: 2 },
  { path: 'src/components/mobileSkin/shell/PhoneContextToolbar.tsx', maxCurrentHits: 2 },
  { path: 'src/components/mobileSkin/shell/PhoneTopBar.tsx', maxCurrentHits: 2 },
  { path: 'src/components/mobileSkin/shell/PhoneTransport.tsx', maxCurrentHits: 2 },
  { path: 'src/components/mobileSkin/text/usePhoneTitleCommands.ts', maxCurrentHits: 9 },
  { path: 'src/components/mobileSkin/timeline/PhoneTrimHandles.tsx', maxCurrentHits: 4 },
  { path: 'src/components/mobileSkin/timeline/usePhoneClipEditGesture.ts', maxCurrentHits: 5 },
  { path: 'src/components/mobileSkin/timeline/usePhoneTimelineNavigation.ts', maxCurrentHits: 2 },
] as const;
