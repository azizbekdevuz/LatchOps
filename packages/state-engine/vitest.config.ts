import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests spawn real `git` processes and create temp repositories,
    // so give them room and run files sequentially to avoid cwd/env contention.
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
