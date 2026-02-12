import { ScopeModeToolbar } from './ScopeModeToolbar';
import { VectorscopeScope } from './VectorscopeScope';
import './ScopesPanel.css';

export function VectorscopePanel() {
  return (
    <div className="scope-panel">
      <ScopeModeToolbar />
      <div className="scope-panel-content">
        <VectorscopeScope />
      </div>
    </div>
  );
}
