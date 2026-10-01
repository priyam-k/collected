import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  // The model package stays external so its native ONNX runtime loads from node_modules.
  noExternal: ['@collected/shared'],
});
