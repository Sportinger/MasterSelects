export interface ColorEditorNode {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
  params: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface ColorEditorVersion {
  id: string;
  name: string;
}

export interface ColorEditorParamDefinition {
  key: string;
  label: string;
  section: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
}
