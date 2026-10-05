import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  typescript: true,
  ignores: [
    'dist/**',
    'node_modules/**',
    '__archived__/**',
    '__references__/**',
    '__temp__/**',
  ],
  rules: {
    // jsdoc/empty-tags fires on `/** @internal — description */` and its
    // auto-fixer is destructive: it strips the surrounding `/**`/`*/` delimiters
    // along with the description text, producing invalid TypeScript.
    // @internal with a description is a valid TSDoc pattern — disable the rule.
    'jsdoc/empty-tags': 'off',
  },
}, {
  files: ['**/*.ts'],
  ignores: ['src/typescript.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'typescript', allowTypeImports: true, message: 'Import the bundled backend through ./typescript.' },
        { name: '@typescript/typescript6', allowTypeImports: true, message: 'Import the bundled backend through ./typescript.' },
      ],
    }],
  },
}, {
  files: ['src/**/*.ts'],
  languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
  rules: {
    'ts/naming-convention': ['error', {
      selector: ['variable', 'parameter', 'classProperty', 'typeProperty'],
      types: ['boolean'],
      format: ['PascalCase'],
      prefix: ['is', 'has', 'can', 'should'],
      // Vitest owns pass; requireDocumentation is the documented instruction setting.
      filter: { regex: '^(pass|requireDocumentation)$', match: false },
    }],
  },
}, {
  files: ['**/*.md'],
  rules: {
    'format/prettier': 'off',
  },
})
