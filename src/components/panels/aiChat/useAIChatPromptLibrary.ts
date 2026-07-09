import { useCallback, useRef, useState } from 'react';
import type { AIProvider } from '../../../stores/settingsStore';
import {
  deleteProjectSystemPrompt,
  getDefaultProjectPromptName,
  listProjectSystemPrompts,
  loadProjectSystemPrompt,
  normalizeProjectPromptName,
  saveProjectSystemPrompt,
  type SavedAiSystemPrompt,
} from '../../../services/aiPromptLibrary';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UseAIChatPromptLibraryParams {
  activeSystemPrompt: string;
  aiProvider: AIProvider;
  defaultSystemPrompt: string;
  setAiSystemPromptOverride: (provider: AIProvider, prompt: string) => void;
}

export function useAIChatPromptLibrary({
  activeSystemPrompt,
  aiProvider,
  defaultSystemPrompt,
  setAiSystemPromptOverride,
}: UseAIChatPromptLibraryParams) {
  const promptFileInputRef = useRef<HTMLInputElement>(null);
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptNameDraft, setPromptNameDraft] = useState('');
  const [savedPromptFiles, setSavedPromptFiles] = useState<SavedAiSystemPrompt[]>([]);
  const [selectedPromptFile, setSelectedPromptFile] = useState('');
  const [promptDialogError, setPromptDialogError] = useState<string | null>(null);
  const [promptDialogStatus, setPromptDialogStatus] = useState<string | null>(null);
  const [isPromptLibraryLoading, setIsPromptLibraryLoading] = useState(false);

  const refreshSavedPromptFiles = useCallback(async () => {
    setIsPromptLibraryLoading(true);
    setPromptDialogError(null);

    try {
      const prompts = await listProjectSystemPrompts(aiProvider);
      setSavedPromptFiles(prompts);
      setSelectedPromptFile((current) => (
        prompts.some((prompt) => prompt.fileName === current)
          ? current
          : prompts[0]?.fileName || ''
      ));
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [aiProvider]);

  const preparePromptDraft = useCallback(() => {
    setPromptDraft(activeSystemPrompt);
    setPromptNameDraft(getDefaultProjectPromptName(aiProvider));
    setPromptDialogError(null);
    setPromptDialogStatus(null);
    void refreshSavedPromptFiles();
  }, [activeSystemPrompt, aiProvider, refreshSavedPromptFiles]);

  const openPromptDialog = useCallback(() => {
    preparePromptDraft();
    setIsPromptDialogOpen(true);
  }, [preparePromptDraft]);

  const applyPromptDraft = useCallback(() => {
    const nextPrompt = promptDraft.trim() === defaultSystemPrompt.trim() ? '' : promptDraft;
    setAiSystemPromptOverride(aiProvider, nextPrompt);
    setPromptDialogError(null);
    setPromptDialogStatus('Applied.');
  }, [aiProvider, defaultSystemPrompt, promptDraft, setAiSystemPromptOverride]);

  const savePromptDialog = useCallback(async () => {
    if (!promptDraft.trim()) {
      return;
    }

    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptLibraryLoading(true);

    try {
      const savedPrompt = await saveProjectSystemPrompt(aiProvider, promptNameDraft, promptDraft);
      const nextPrompt = promptDraft.trim() === defaultSystemPrompt.trim() ? '' : promptDraft;
      setAiSystemPromptOverride(aiProvider, nextPrompt);
      setPromptNameDraft(savedPrompt.name);
      setSelectedPromptFile(savedPrompt.fileName);
      setPromptDialogStatus('Saved to project.');
      await refreshSavedPromptFiles();
      setSelectedPromptFile(savedPrompt.fileName);
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [
    aiProvider,
    defaultSystemPrompt,
    promptDraft,
    promptNameDraft,
    refreshSavedPromptFiles,
    setAiSystemPromptOverride,
  ]);

  const loadSelectedProjectPrompt = useCallback(async (fileName = selectedPromptFile) => {
    if (!fileName) {
      return;
    }

    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptLibraryLoading(true);

    try {
      const loadedPrompt = await loadProjectSystemPrompt(fileName);
      const nextPrompt = loadedPrompt.prompt.trim() === defaultSystemPrompt.trim() ? '' : loadedPrompt.prompt;
      setPromptDraft(loadedPrompt.prompt);
      setPromptNameDraft(loadedPrompt.name);
      setSelectedPromptFile(fileName);
      setAiSystemPromptOverride(loadedPrompt.provider, nextPrompt);
      setPromptDialogStatus('Loaded and applied.');
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [defaultSystemPrompt, selectedPromptFile, setAiSystemPromptOverride]);

  const overwriteSelectedProjectPrompt = useCallback(async () => {
    if (!selectedPromptFile || !promptDraft.trim()) {
      return;
    }

    const selectedPrompt = savedPromptFiles.find((prompt) => prompt.fileName === selectedPromptFile);
    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptLibraryLoading(true);

    try {
      const savedPrompt = await saveProjectSystemPrompt(aiProvider, selectedPrompt?.name ?? promptNameDraft, promptDraft);
      const nextPrompt = promptDraft.trim() === defaultSystemPrompt.trim() ? '' : promptDraft;
      setAiSystemPromptOverride(aiProvider, nextPrompt);
      setPromptNameDraft(savedPrompt.name);
      setSelectedPromptFile(savedPrompt.fileName);
      setPromptDialogStatus('Preset overwritten.');
      await refreshSavedPromptFiles();
      setSelectedPromptFile(savedPrompt.fileName);
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [
    aiProvider,
    defaultSystemPrompt,
    promptDraft,
    promptNameDraft,
    refreshSavedPromptFiles,
    savedPromptFiles,
    selectedPromptFile,
    setAiSystemPromptOverride,
  ]);

  const deleteSelectedProjectPrompt = useCallback(async () => {
    if (!selectedPromptFile) {
      return;
    }

    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptLibraryLoading(true);

    try {
      await deleteProjectSystemPrompt(selectedPromptFile);
      setPromptDialogStatus('Preset deleted.');
      await refreshSavedPromptFiles();
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [refreshSavedPromptFiles, selectedPromptFile]);

  const resetPromptDraft = useCallback(() => {
    setPromptDraft(defaultSystemPrompt);
    setPromptNameDraft(getDefaultProjectPromptName(aiProvider));
    setPromptDialogError(null);
    setPromptDialogStatus(null);
  }, [aiProvider, defaultSystemPrompt]);

  const exportPromptDraft = useCallback(() => {
    const blob = new Blob([promptDraft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `masterselects-${aiProvider}-system-prompt.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [aiProvider, promptDraft]);

  const loadPromptFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setPromptDraft(await file.text());
    setPromptNameDraft(normalizeProjectPromptName(file.name.replace(/\.[^.]+$/, ''), aiProvider));
    setPromptDialogError(null);
    setPromptDialogStatus('Imported. Save to project.');
    event.target.value = '';
  }, [aiProvider]);

  return {
    applyPromptDraft,
    deleteSelectedProjectPrompt,
    exportPromptDraft,
    isPromptDialogOpen,
    isPromptLibraryLoading,
    loadPromptFile,
    loadSelectedProjectPrompt,
    overwriteSelectedProjectPrompt,
    openPromptDialog,
    preparePromptDraft,
    promptDialogError,
    promptDialogStatus,
    promptDraft,
    promptFileInputRef,
    promptNameDraft,
    refreshSavedPromptFiles,
    resetPromptDraft,
    savePromptDialog,
    savedPromptFiles,
    selectedPromptFile,
    setIsPromptDialogOpen,
    setPromptDraft,
    setPromptNameDraft,
    setSelectedPromptFile,
  };
}
