// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Package dependency rules from docs/11-repository-structure.md.
 *
 *   domain <- intelligence
 *      ^          ^
 *      +-- db <- core <- agent
 *                 ^        ^
 *           contracts -----+---> api -> { web, cli, mobile }
 *                    ui, viz, graph ---> web
 *
 * Enforced with no-restricted-imports rather than eslint-plugin-boundaries:
 * one fewer dependency, no module-resolution guesswork across workspace
 * symlinks, and the rule reads as the rule. (Design rule 6.)
 */

/** Everything that performs I/O. `packages/intelligence` may touch none of it. */
const IO_MODULES = [
  'node:*',
  'fs',
  'fs/*',
  'path',
  'os',
  'crypto',
  'http',
  'https',
  'child_process',
  'worker_threads',
  '@libsql/*',
  'drizzle-orm',
  'drizzle-orm/*',
  'fastify',
  '@trpc/*',
];

/** @param {string[]} allowed @returns {string[]} */
const onlyWorkspace = (allowed) => [
  '@aryesh/*',
  ...allowed.map((a) => `!@aryesh/${a}`),
];

/** @param {string} name @param {string[]} allowed @param {string[]} [extraBanned] */
const boundary = (name, allowed, extraBanned = []) => ({
  files: [`packages/${name}/**/*.ts`, `packages/${name}/**/*.tsx`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: onlyWorkspace(allowed),
            message: `packages/${name} may only import: ${allowed.map((a) => `@aryesh/${a}`).join(', ') || '(nothing)'}. See docs/11-repository-structure.md.`,
          },
          ...(extraBanned.length
            ? [
                {
                  group: extraBanned,
                  message: `packages/${name} must stay pure — no I/O, no clock, no network. Take what you need as a parameter. See docs/11-repository-structure.md.`,
                },
              ]
            : []),
        ],
      },
    ],
  },
});

/** @param {string} name @param {string[]} allowed */
const appBoundary = (name, allowed) => ({
  files: [`apps/${name}/**/*.ts`, `apps/${name}/**/*.tsx`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: onlyWorkspace(allowed),
            message: `apps/${name} may only import: ${allowed.map((a) => `@aryesh/${a}`).join(', ')}. See docs/11-repository-structure.md.`,
          },
        ],
      },
    ],
  },
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'data/**',
      'docs/**',
      'scratch/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression[typeAnnotation.typeName.name="any"]',
          message: 'No `as any`. Model the type or narrow it.',
        },
      ],
    },
  },

  // ---- package boundaries -------------------------------------------------
  boundary('domain', []),
  boundary('intelligence', ['domain'], IO_MODULES),
  boundary('db', ['domain']),
  boundary('contracts', ['domain']),
  boundary('core', ['domain', 'db', 'intelligence', 'contracts']),
  boundary('agent', ['domain', 'core', 'contracts']),
  boundary('ui', ['domain', 'contracts']),
  boundary('viz', ['domain', 'contracts']),
  boundary('graph', ['domain', 'contracts']),

  appBoundary('api', ['domain', 'db', 'intelligence', 'core', 'contracts', 'agent']),
  appBoundary('web', ['domain', 'contracts', 'ui', 'viz', 'graph']),
  appBoundary('cli', ['domain', 'contracts']),

  // Tests may reach for fixtures and fake clocks freely.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    files: ['**/*.js', '**/*.config.ts', '**/*.config.js'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
