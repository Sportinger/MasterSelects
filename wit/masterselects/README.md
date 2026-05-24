# MasterSelects WIT Runtime ABI

This package defines the reviewed, versioned ABI boundary for future Wasm Component importers.

Current package:

```text
masterselects:runtime@0.1.0
```

The first world is `masterselects-importer`. It accepts file bytes and returns Signal IR references plus diagnostics. Browser integration can load native Components later or use a `jco transpile` ES-module fallback when direct Component loading is blocked.

The host-side fallback shape is intentionally small and testable:

```ts
export function canImport(fileName: string, mimeType: string, header: Uint8Array): boolean;
export function importFile(request: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{
  signals: Array<{
    id: string;
    kind: string;
    artifact?: { id: string; hash: string; mimeType: string; size: number };
    metadataJson: string;
  }>;
  diagnosticsJson: string;
}>;
```

Toolchain target commands:

```bash
node scripts/wasm/check-jco-toolchain.mjs
npm exec --yes @bytecodealliance/jco -- transpile path/to/importer.component.wasm --out-dir dist/wasm/masterselects-importer
```

No Rust/Wasm toolchain is required for unit tests. The TypeScript fixture at `src/runtime/wasm/fixtures/csvBinaryImporter.ts` implements the jco-compatible importer shape and processes real CSV/binary bytes.
