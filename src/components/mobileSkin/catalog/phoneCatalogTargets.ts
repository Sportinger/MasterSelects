// Where a catalog feature lives on the phone. One target per catalog id (phoneCatalogCoverage.ts);
// the coverage test checks every target against the real phone catalogs, so a renamed action,
// sheet, panel or editor shows up as a failing id instead of a silently stale table.

import type { PanelType } from '../../../types/dock';
import type { PropertiesTab } from '../../panels/properties/propertiesPanelTypes';
import type { PhoneSheetId } from '../contracts';
import type { PhoneWorkspaceId } from '../workspace/phoneWorkspaceCatalog';

export type PhoneCatalogTarget =
  /** A toolbar action of actions/phoneActionCatalog.ts (root or clip toolbar). */
  | { kind: 'action'; id: string }
  /** A bottom sheet of sheets/phoneSheetRegistry.tsx; `testId` names the row or control inside it. */
  | { kind: 'sheet'; id: PhoneSheetId; testId?: string }
  /** A desktop panel shown on the phone (All tools); `tab` names the Properties tab that holds it. */
  | { kind: 'panel'; type: PanelType; tab?: PropertiesTab }
  /** A landscape editor of workspace/phoneWorkspaceCatalog.ts. */
  | { kind: 'workspace'; id: PhoneWorkspaceId }
  /** A control of the always-visible phone shell (timeline, transport, top bar, preview). */
  | { kind: 'shell'; testId: string; note: string }
  /** Done through the assistant (the Assistant action and sheet run the editor's chat tools). */
  | { kind: 'assistant' }
  /**
   * Visible but greyed on the phone: the control `testId` (inside `sheet` when given, `select`
   * narrows it by an attribute) explains `reason` on tap.
   */
  | { kind: 'exception'; reason: string; sheet?: PhoneSheetId; testId: string; select?: string }
  /** Open: neither built nor greyed anywhere on the phone yet. `note` says what is missing. */
  | { kind: 'gap'; note: string };

export type PhoneCatalogTargetKind = PhoneCatalogTarget['kind'];

export const action = (id: string): PhoneCatalogTarget => ({ kind: 'action', id });
export const sheet = (id: PhoneSheetId, testId?: string): PhoneCatalogTarget => ({ kind: 'sheet', id, ...(testId ? { testId } : {}) });
export const panel = (type: PanelType, tab?: PropertiesTab): PhoneCatalogTarget => ({ kind: 'panel', type, ...(tab ? { tab } : {}) });
export const props = (tab?: PropertiesTab): PhoneCatalogTarget => panel('clip-properties', tab);
export const workspace = (id: PhoneWorkspaceId): PhoneCatalogTarget => ({ kind: 'workspace', id });
export const shell = (testId: string, note: string): PhoneCatalogTarget => ({ kind: 'shell', testId, note });
export const assistant: PhoneCatalogTarget = { kind: 'assistant' };
export const greyed = (reason: string, sheetId: PhoneSheetId | undefined, testId: string, select?: string): PhoneCatalogTarget => ({
  kind: 'exception', reason, testId, ...(sheetId ? { sheet: sheetId } : {}), ...(select ? { select } : {}),
});
export const gap = (note: string): PhoneCatalogTarget => ({ kind: 'gap', note });
