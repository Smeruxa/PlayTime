module.exports = {
    root: true,
    extends: '@react-native',
    ignorePatterns: ['node_modules/', 'android/', 'e2e/artifacts/', 'coverage/', 'design/'],
    rules: {
        'react-hooks/exhaustive-deps': 'error',
        'react-native/no-inline-styles': 'off',
        'no-void': 'off',
        curly: ['error', 'all'],
        'max-statements-per-line': ['error', { max: 1 }],
        'one-var': ['error', 'never'],
        'react/no-multi-comp': ['error', { ignoreStateless: false }],
    },
    overrides: [
        {
            files: ['**/*.ts', '**/*.tsx'],
            rules: {
                '@typescript-eslint/no-explicit-any': 'error',
                '@typescript-eslint/no-unused-vars': [
                    'error',
                    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
                ],
            },
        },
    ],
};
