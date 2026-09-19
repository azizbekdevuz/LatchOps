// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Deterministic-core lint configuration (Phases 1–2).
 *
 * Scope is intentionally limited to the deterministic TypeScript packages
 * (`packages/schema`, `packages/state-engine`, `packages/recovery-engine`, and
 * `apps/cli`). The Next.js app (`apps/web`) carries its own ESLint stack
 * (eslint-config-next); a unified repo-wide lint story is deferred to a later
 * phase.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'apps/web/**',
    ],
  },
  {
    files: [
      'packages/state-engine/src/**/*.ts',
      'packages/schema/src/**/*.ts',
      'packages/recovery-engine/src/**/*.ts',
      'apps/cli/src/**/*.ts',
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    // Test and test-support files may use looser typing for fixtures.
    files: ['**/*.test.ts', '**/test-support/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
