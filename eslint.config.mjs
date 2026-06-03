import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  typescript: true,
  ignores: ['dist/**', 'node_modules/**'],
  rules: {
    // jsdoc/empty-tags fires on `/** @internal — description */` and its
    // auto-fixer is destructive: it strips the surrounding `/**`/`*/` delimiters
    // along with the description text, producing invalid TypeScript.
    // @internal with a description is a valid TSDoc pattern — disable the rule.
    'jsdoc/empty-tags': 'off',
  },
}, {
  files: ['**/*.md'],
  rules: {
    'format/prettier': 'off',
  },
})
