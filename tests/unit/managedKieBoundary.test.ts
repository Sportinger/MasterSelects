import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('managed Kie.ai boundary', () => {
  it('has no browser key setting or direct proxy route', () => {
    const directRoute = ['/api/kieai', '/byo'].join('');
    const credentialHeader = ['x-kieai', '-api-key'].join('');
    const clientSources = [
      'src/stores/settings/settingsOptions.ts',
      'src/components/common/settings/IntegrationCredentialsSettings.tsx',
      'src/services/flashboard/FlashBoardChatTypes.ts',
      'src/services/flashboard/FlashBoardChatProviderTransport.ts',
      'vite.config.ts',
    ].map(source).join('\n');

    expect(clientSources).not.toContain(directRoute);
    expect(clientSources).not.toContain(credentialHeader);
    expect(clientSources).not.toMatch(/\bkieAiApiKey\b/);
    expect(existsSync(resolve(repoRoot, 'functions/api/kieai/byo/request.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'functions/api/kieai/byo/upload.ts'))).toBe(false);
  });

  it('removes stale encrypted Kie.ai records during the IndexedDB upgrade', () => {
    const managerSource = source('src/services/youtubeCredentialManager.ts');

    expect(managerSource).toContain('const DB_VERSION = 3');
    expect(managerSource).toContain("'kieai-api-key'");
    expect(managerSource).toContain('store?.delete(id)');
  });

  it('keeps removed provider ids only at the old-project migration boundary', () => {
    const runtimeTypes = source('src/stores/flashboardStore/types.ts');
    const projectTypes = source('src/services/project/types/flashboard.types.ts');
    const hydration = source('src/services/project/load/loadDockFlashboardHydration.ts');

    expect(runtimeTypes).not.toMatch(/FlashBoardService[^;]*['"]kieai['"]/);
    expect(runtimeTypes).not.toMatch(/FlashBoardService[^;]*['"]suno['"]/);
    expect(projectTypes).toContain("| 'kieai'");
    expect(projectTypes).toContain("| 'suno'");
    expect(hydration).toContain("return 'cloud';");
  });
});

describe('removed Multicam AI dock panel', () => {
  it('is absent from the dock registry and source tree', () => {
    expect(source('src/types/dock.ts')).not.toMatch(/PanelType[^;]*['"]multicam['"]/);
    expect(source('src/stores/dockStore/panelRegistry.ts')).not.toContain("type: 'multicam'");
    expect(existsSync(resolve(repoRoot, 'src/components/panels/MultiCamPanel.tsx'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'src/stores/multicamStore.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'src/services/multicamAnalyzer.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'src/services/claudeService.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'src/services/whisperService.ts'))).toBe(false);
  });
});
