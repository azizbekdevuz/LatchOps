import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/lib/**/*.integration.test.ts'],
    environment: 'node',
    setupFiles: ['./src/lib/test-support/integration-setup.ts'],
    globalSetup: ['./scripts/vitest-integration-global-setup.ts'],
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
    },
  },
});
