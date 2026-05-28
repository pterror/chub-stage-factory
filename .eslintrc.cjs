module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Allow _-prefixed params and destructured vars as intentional ignores
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
  },
  overrides: [
    {
      // Structural any: delegator/runner are intentionally untyped wrappers
      // over the generic StageBase<I,C,M,Config> type parameters.
      files: [
        'src/Stage.tsx',
        'src/composition/CompositionRunner.ts',
        'src/composition/merge.ts',
        'src/lib/persistence/chub.ts',
        'src/lib/persistence/store.ts',
      ],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // Chub Stage files export one class (not a component) alongside React
      // helper components in the same file — this is the required Chub pattern.
      // react-refresh/only-export-components fires on every example Stage.tsx.
      // react-hooks/exhaustive-deps: deferred — runner files use deliberate
      //   incomplete dep arrays (addEntry is stable by construction; step refs
      //   are intentionally excluded to avoid spurious re-binds).
      files: [
        'examples/*/Stage.tsx',
        'src/runner/*.tsx',
        'src/runner/main.tsx',
        'src/TestRunner.tsx',
      ],
      rules: {
        'react-refresh/only-export-components': 'off',
        'react-hooks/exhaustive-deps': 'off',
      },
    },
    {
      // FormBuilder exports a helper function (formFieldsFromVerb) alongside its
      // React component — intentional co-location for the form-building API.
      files: ['src/lib/ui/FormBuilder.tsx'],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
    {
      // voronoi-influence-map: hoverConfig/entryConfig are derived from prop
      // conditionals — wrapping in useMemo is the correct fix but is deferred
      // to avoid changing animation behaviour in this pass.
      files: ['src/lib/ui/voronoi-influence-map.tsx'],
      rules: {
        'react-hooks/exhaustive-deps': 'off',
      },
    },
  ],
}
