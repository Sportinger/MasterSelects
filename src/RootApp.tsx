import { lazy, Suspense, type CSSProperties } from 'react';
import { LandingPage } from './marketing/LandingPage';
import type { EntryExperience } from './routing/entryExperience';

const EditorApp = lazy(() => import('./App'));
const CreditClaimPage = lazy(() =>
  import('./creditClaims/CreditClaimPage').then((module) => ({ default: module.CreditClaimPage }))
);

interface RootAppProps {
  initialExperience: EntryExperience;
}

const loadingShellStyle: CSSProperties = {
  alignItems: 'center',
  background: 'linear-gradient(135deg, #101215 0%, #1c222a 100%)',
  color: '#f5f7fa',
  display: 'flex',
  fontFamily: '"Segoe UI", sans-serif',
  fontSize: '16px',
  height: '100%',
  justifyContent: 'center',
  width: '100%',
};

export function RootApp({ initialExperience }: RootAppProps) {
  if (initialExperience === 'landing') {
    return <LandingPage />;
  }

  if (initialExperience === 'creditClaim') {
    return (
      <Suspense fallback={<div style={loadingShellStyle}>Opening credit claim...</div>}>
        <CreditClaimPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div style={loadingShellStyle}>Opening MasterSelects...</div>}>
      <EditorApp />
    </Suspense>
  );
}

export default RootApp;
