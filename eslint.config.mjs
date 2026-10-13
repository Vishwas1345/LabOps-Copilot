import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Rules here are not stylistic preferences - each one encodes a constraint
 * from CLAUDE.md that would otherwise be enforced only by convention.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/generated/**',
      // Next.js owns and rewrites this file on every build; it even carries its
      // own "do not edit" notice. Linting it only produces false failures.
      '**/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser },
    },
    settings: {
      // Resolves the backend's NodeNext `./foo.js` specifiers to `./foo.ts`
      // so import/no-cycle and import/no-unresolved work as intended.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './apps/*/tsconfig.json',
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      // CLAUDE.md 4: circular imports are a bug, not a style choice
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error',
      'import/order': [
        'warn',
        { groups: ['builtin', 'external', 'internal', 'parent', 'sibling'] },
      ],

      // CLAUDE.md 7: strict TypeScript, no escape hatches
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  {
    // CLAUDE.md 7: never console.log in backend source
    files: ['apps/api/**/*.ts'],
    rules: { 'no-console': 'error' },
  },

  {
    // Next.js server components may legitimately print during dev tooling;
    // the backend rule does not apply here.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'import/no-extraneous-dependencies': [
        'error',
        { devDependencies: true },
      ],
    },
  },
);