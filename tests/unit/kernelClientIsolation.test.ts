import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const kernelClientRoot = path.join(repoRoot, 'src', 'services', 'kernelClient');
const kernelTransportFiles = [
  path.join(kernelClientRoot, 'index.ts'),
  path.join(kernelClientRoot, 'types.ts'),
];
const kernelClientFiles = [
  ...kernelTransportFiles,
  path.join(kernelClientRoot, 'kernelChatGateway.ts'),
  path.join(kernelClientRoot, 'storyVerification.ts'),
  path.join(kernelClientRoot, 'transcriptMoments.ts'),
];
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const staticModuleSpecifierPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'\x22;]*?\sfrom\s*)?['\x22]([^'\x22]+)['\x22]/g;
const dynamicImportSpecifierPattern = /\bimport\s*\(\s*['\x22]([^'\x22]+)['\x22]\s*\)/g;

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function walkSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const filePath = path.join(root, entry);
    if (statSync(filePath).isDirectory()) return walkSourceFiles(filePath);
    return sourceExtensions.has(path.extname(filePath)) ? [filePath] : [];
  });
}

function importedSpecifiers(source: string): string[] {
  return [
    ...[...source.matchAll(staticModuleSpecifierPattern)].map((match) => match[1]),
    ...[...source.matchAll(dynamicImportSpecifierPattern)].map((match) => match[1]),
  ];
}

describe('kernel client isolation', () => {
  it('keeps every transport dependency relative', () => {
    for (const filePath of kernelTransportFiles) {
      for (const specifier of importedSpecifiers(readFileSync(filePath, 'utf8'))) {
        expect(specifier.startsWith('.'), `${toRepoPath(filePath)} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('keeps transport dependencies inside the kernel client directory', () => {
    for (const filePath of kernelTransportFiles) {
      for (const specifier of importedSpecifiers(readFileSync(filePath, 'utf8'))) {
        const resolved = path.resolve(path.dirname(filePath), specifier);
        const relative = path.relative(kernelClientRoot, resolved);
        const escapes = relative === '..'
          || relative.startsWith(`..${path.sep}`)
          || path.isAbsolute(relative);
        expect(escapes, `${toRepoPath(filePath)} escapes through ${specifier}`).toBe(false);
      }
    }
  });

  it('does not ship kernel logic, prompt, or pack vocabulary', () => {
    const forbiddenLeakage = [
      'masterselects-kernel',
      'expertPack',
      'blueprint',
      'systemPrompt',
      'rubric',
    ];

    for (const filePath of kernelClientFiles) {
      const source = readFileSync(filePath, 'utf8').toLowerCase();
      const privateSource = source.replaceAll('blueprintsummary', '');
      for (const forbidden of forbiddenLeakage) {
        expect(privateSource, `${toRepoPath(filePath)} contains ${forbidden}`)
          .not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('keeps the FlashBoard pre-hook as the only gateway import site', () => {
    const importSites = walkSourceFiles(path.join(repoRoot, 'src')).flatMap((filePath) =>
      importedSpecifiers(readFileSync(filePath, 'utf8'))
        .filter((specifier) => /(?:^|\/)kernelChatGateway(?:\.[cm]?[jt]sx?)?$/.test(specifier))
        .map((specifier) => ({ file: toRepoPath(filePath), specifier })),
    );

    expect(importSites).toEqual([{
      file: 'src/services/flashboard/FlashBoardChatService.ts',
      specifier: '../kernelClient/kernelChatGateway',
    }]);
  });

  it('keeps the localStorage gate keys exact and complete', () => {
    const gatewaySource = readFileSync(
      path.join(kernelClientRoot, 'kernelChatGateway.ts'),
      'utf8',
    );
    const matches = gatewaySource.matchAll(/['\x22](ms\.kernel\.[^'\x22]+)['\x22]/g);
    const gateKeys = [...new Set([...matches].map((match) => match[1]))].toSorted();

    expect(gateKeys).toEqual([
      'ms.kernel.enabled',
      'ms.kernel.fallback',
      'ms.kernel.token',
      'ms.kernel.url',
    ]);
  });
});
