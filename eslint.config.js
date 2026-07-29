import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['apps/**/*.{ts,tsx}'];
const typescriptConfig = config => ({ ...config, files: typescriptFiles });

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict.map(typescriptConfig),
  {
    files: ['*.{js,mjs}', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: typescriptFiles,
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/\\.js$/]',
          message: 'Use an extensionless TypeScript import instead of a .js suffix.',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/\\.js$/]',
          message: 'Use an extensionless TypeScript export instead of a .js suffix.',
        },
      ],
    },
  },
  {
    files: ['apps/frontend/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    files: ['apps/frontend/tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['apps/backend/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  eslintConfigPrettier,
);
