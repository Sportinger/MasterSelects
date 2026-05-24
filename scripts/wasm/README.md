# Wasm / jco Toolchain Notes

Slice 4 keeps the host testable without requiring a local Rust or WebAssembly Component build.

Optional checks:

```bash
node scripts/wasm/check-jco-toolchain.mjs
```

Useful commands once a real Component is available:

```bash
npm exec --yes @bytecodealliance/jco -- transpile path/to/importer.component.wasm --out-dir dist/wasm/masterselects-importer
npm exec --yes @bytecodealliance/componentize-js -- --wit wit/masterselects/runtime.wit --world masterselects-importer path/to/importer.js -o dist/wasm/importer.component.wasm
```

The TypeScript fixture at `src/runtime/wasm/fixtures/csvBinaryImporter.ts` exports the same `canImport(fileName, mimeType, header)` and `importFile(request)` shape expected from a jco-transpiled importer module. Unit tests exercise that fixture directly through `WasmImporterHost`.
