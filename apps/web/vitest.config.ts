import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Scope tests to pure library units. Route/component tests that require the
    // Next.js runtime are out of scope for the Phase 1 interim guard.
    include: ['src/lib/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
    environment: 'node',
  },
});
