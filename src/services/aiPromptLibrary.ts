import { projectFileService } from './project/ProjectFileService';
import type { AIProvider } from '../stores/settingsStore';

const PROMPT_FILE_SUFFIX = '.prompt.json';
const PROMPT_FILE_VERSION = 1;
const MAX_PROMPT_NAME_LENGTH = 80;

interface StoredAiSystemPrompt {
  version: typeof PROMPT_FILE_VERSION;
  name: string;
  provider: AIProvider;
  prompt: string;
  updatedAt: string;
}

export interface SavedAiSystemPrompt {
  fileName: string;
  name: string;
  provider: AIProvider;
  updatedAt: string;
}

export interface LoadedAiSystemPrompt extends SavedAiSystemPrompt {
  prompt: string;
}

export function getDefaultProjectPromptName(provider: AIProvider): string {
  return provider === 'lemonade' ? 'Lemonade system prompt' : 'OpenAI system prompt';
}

export function isProjectPromptStorageAvailable(): boolean {
  return projectFileService.isProjectOpen();
}

export function normalizeProjectPromptName(name: string, provider: AIProvider): string {
  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, MAX_PROMPT_NAME_LENGTH) : getDefaultProjectPromptName(provider);
}

function makePromptFileName(provider: AIProvider, name: string): string {
  const safeName = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_PROMPT_NAME_LENGTH)
    || 'system-prompt';

  return `${provider}--${safeName}${PROMPT_FILE_SUFFIX}`;
}

function parseStoredPrompt(fileName: string, text: string): LoadedAiSystemPrompt | null {
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const stored = payload as Partial<StoredAiSystemPrompt>;

  if (
    stored.version !== PROMPT_FILE_VERSION
    || (stored.provider !== 'openai' && stored.provider !== 'lemonade')
    || typeof stored.name !== 'string'
    || typeof stored.prompt !== 'string'
    || typeof stored.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    fileName,
    name: normalizeProjectPromptName(stored.name, stored.provider),
    prompt: stored.prompt,
    provider: stored.provider,
    updatedAt: stored.updatedAt,
  };
}

export async function listProjectSystemPrompts(provider?: AIProvider): Promise<SavedAiSystemPrompt[]> {
  if (!projectFileService.isProjectOpen()) {
    return [];
  }

  const files = await projectFileService.listFiles('PROMPTS');
  const prompts: SavedAiSystemPrompt[] = [];

  for (const fileName of files.filter((name) => name.endsWith(PROMPT_FILE_SUFFIX))) {
    const file = await projectFileService.readFile('PROMPTS', fileName);
    if (!file) {
      continue;
    }

    const parsed = parseStoredPrompt(fileName, await file.text());
    if (!parsed || (provider && parsed.provider !== provider)) {
      continue;
    }

    prompts.push({
      fileName: parsed.fileName,
      name: parsed.name,
      provider: parsed.provider,
      updatedAt: parsed.updatedAt,
    });
  }

  return prompts.toSorted((a, b) => {
    const providerOrder = a.provider.localeCompare(b.provider);
    return providerOrder !== 0 ? providerOrder : a.name.localeCompare(b.name);
  });
}

export async function loadProjectSystemPrompt(fileName: string): Promise<LoadedAiSystemPrompt> {
  if (!projectFileService.isProjectOpen()) {
    throw new Error('Open a project before loading saved prompts.');
  }

  const file = await projectFileService.readFile('PROMPTS', fileName);
  if (!file) {
    throw new Error('Saved prompt was not found.');
  }

  const parsed = parseStoredPrompt(fileName, await file.text());
  if (!parsed) {
    throw new Error('Saved prompt file is invalid.');
  }

  return parsed;
}

export async function saveProjectSystemPrompt(
  provider: AIProvider,
  name: string,
  prompt: string,
): Promise<SavedAiSystemPrompt> {
  if (!projectFileService.isProjectOpen()) {
    throw new Error('Open a project before saving prompts.');
  }

  const promptName = normalizeProjectPromptName(name, provider);
  const fileName = makePromptFileName(provider, promptName);
  const updatedAt = new Date().toISOString();
  const storedPrompt: StoredAiSystemPrompt = {
    name: promptName,
    prompt,
    provider,
    updatedAt,
    version: PROMPT_FILE_VERSION,
  };

  const saved = await projectFileService.writeFile(
    'PROMPTS',
    fileName,
    JSON.stringify(storedPrompt, null, 2),
  );

  if (!saved) {
    throw new Error('Failed to save prompt in the project folder.');
  }

  return {
    fileName,
    name: promptName,
    provider,
    updatedAt,
  };
}
