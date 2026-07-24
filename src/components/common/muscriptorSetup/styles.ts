import type { CSSProperties } from 'react';

export const muscriptorStyles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 12000, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 24, background: 'rgba(4, 6, 12, 0.78)',
    backdropFilter: 'blur(8px)',
  },
  dialog: {
    width: 'min(760px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
    border: '1px solid rgba(139, 148, 180, 0.28)', borderRadius: 14,
    background: 'linear-gradient(150deg, #191d2b, #10131d)', color: '#eef1ff',
    boxShadow: '0 26px 90px rgba(0, 0, 0, 0.58)',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid rgba(139, 148, 180, 0.16)',
  },
  title: { margin: 0, fontSize: 21, fontWeight: 650 },
  subtitle: { margin: '5px 0 0', color: '#aeb5cf', fontSize: 13 },
  close: {
    border: 0, background: 'transparent', color: '#b7bdd2', cursor: 'pointer',
    fontSize: 23, lineHeight: 1, padding: 4,
  },
  body: { display: 'grid', gap: 16, padding: 22 },
  section: {
    padding: 16, border: '1px solid rgba(139, 148, 180, 0.18)', borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.025)',
  },
  sectionTitle: { margin: '0 0 10px', fontSize: 14, fontWeight: 650 },
  muted: { margin: 0, color: '#aeb5cf', fontSize: 12, lineHeight: 1.5 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  label: { display: 'grid', gap: 6, color: '#c8cee3', fontSize: 12 },
  input: {
    width: '100%', boxSizing: 'border-box', border: '1px solid rgba(139, 148, 180, 0.32)',
    borderRadius: 7, background: '#0c0f18', color: '#f5f6ff', padding: '8px 10px',
  },
  button: {
    border: '1px solid rgba(139, 148, 180, 0.32)', borderRadius: 7,
    background: '#262c3e', color: '#f1f3ff', padding: '8px 12px', cursor: 'pointer',
    fontSize: 12, fontWeight: 600,
  },
  primaryButton: {
    border: '1px solid #6d7ef5', borderRadius: 7, background: '#5869de', color: '#fff',
    padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 650,
  },
  dangerButton: {
    border: '1px solid rgba(239, 95, 106, 0.55)', borderRadius: 7,
    background: 'rgba(169, 45, 57, 0.2)', color: '#ffb9bf', padding: '8px 12px',
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  status: {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 9px',
    borderRadius: 999, background: 'rgba(94, 111, 220, 0.16)', color: '#cbd2ff', fontSize: 12,
  },
  progressTrack: { height: 7, borderRadius: 999, overflow: 'hidden', background: '#090b11' },
  progressFill: { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #596ae1, #8c78f0)' },
  log: {
    margin: '10px 0 0', maxHeight: 100, overflowY: 'auto', padding: 10,
    borderRadius: 7, background: '#090b11', color: '#aeb5cf', fontSize: 11,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', whiteSpace: 'pre-wrap',
  },
  error: {
    padding: 10, border: '1px solid rgba(239, 95, 106, 0.42)', borderRadius: 7,
    background: 'rgba(169, 45, 57, 0.14)', color: '#ffc0c5', fontSize: 12,
  },
  success: {
    padding: 10, border: '1px solid rgba(73, 195, 139, 0.38)', borderRadius: 7,
    background: 'rgba(36, 145, 96, 0.14)', color: '#adf2cf', fontSize: 12,
  },
  instruments: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: '7px 12px', maxHeight: 170, overflowY: 'auto', marginTop: 10,
  },
  checkbox: { display: 'flex', alignItems: 'center', gap: 7, color: '#c8cee3', fontSize: 12 },
  license: {
    padding: 12, borderRadius: 8, background: 'rgba(225, 174, 79, 0.09)',
    color: '#d8c69f', fontSize: 12, lineHeight: 1.5,
  },
};

export function disabledStyle(disabled: boolean): CSSProperties {
  return disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {};
}
