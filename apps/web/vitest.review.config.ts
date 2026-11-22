import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Recovery Review end-to-end tests and the evaluation harness. Both spawn git
 * and use a temporary SQLite file; no network or external database.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/lib/review/**/*.e2e.test.ts', 'scripts/review/**/*.eval.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
