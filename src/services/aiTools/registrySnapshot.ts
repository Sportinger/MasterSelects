import { AI_TOOLS } from './definitions';
import { getRegisteredToolHandlerNames } from './handlers';
import { getRegisteredToolPolicyNames } from './policy/registry';
import { MODIFYING_TOOLS } from './types';

export interface ToolRegistrySnapshot {
  definitionNames: string[];
  policyNames: string[];
  handlerNames: string[];
  modifyingToolNames: string[];
}

export function getToolRegistrySnapshot(): ToolRegistrySnapshot {
  return {
    definitionNames: AI_TOOLS.map((tool) => tool.function.name).toSorted(),
    policyNames: getRegisteredToolPolicyNames().toSorted(),
    handlerNames: getRegisteredToolHandlerNames().toSorted(),
    modifyingToolNames: [...MODIFYING_TOOLS].toSorted(),
  };
}
