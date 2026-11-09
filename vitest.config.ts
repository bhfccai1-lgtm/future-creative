import { defineConfig } from 'vitest/config';
import path from 'node:path';
const alias = { '@': path.resolve(__dirname, 'src') };
export default defineConfig({
  resolve: { alias },
  test: {
    fileParallelism: false,
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node', testTimeout: 60000 } },
      {
        resolve: { alias },
        test: {
          name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node',
          setupFiles: ['tests/integration/setup.ts'], globalSetup: ['tests/integration/global-setup.ts'], sequence: { concurrent: false }, testTimeout: 120000, hookTimeout: 120000,
        },
      },
    ],
  },
});
