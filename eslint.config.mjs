import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/generated/**',
      '.local-tools/**', '.local-data/**',
      // โค้ดชุดเดิม (zero-dependency) — จะถูกถอดออกหลัง Milestone 1 (ดู docs/architecture/ADR-001)
      'fb-pages.mjs', 'make-card.mjs', 'server.mjs', 'lib/**', 'web/**', 'test/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
