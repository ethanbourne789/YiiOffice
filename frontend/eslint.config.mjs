// Flat config for the tooling/build scripts that are plain JavaScript.
//
// Scope note: the application source is TypeScript 7.x. `typescript-eslint`
// v8 declares a peer range of TypeScript <6.1.0, so installing it would leave
// an unsupported (and possibly broken) dependency tree. TS/TSX stays covered
// by `tsc --noEmit` in CI; once a TypeScript-7-compatible parser is available,
// add a second config block for `**/*.{ts,tsx}` here and widen the rules.
import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/bindings/**',
      // Vendored third-party converter: not our code, not maintained here.
      '**/vendor/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: {
      // Surface stale `eslint-disable-*` comments without breaking the build.
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-debugger': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]
