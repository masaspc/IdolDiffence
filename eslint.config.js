// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * 決定性を守るためのルールが要。
 * sim は同じ seed + 同じ入力なら必ず同じ結果になる必要があり、
 * Math.random() / Date.now() / new Date() の直接使用はそれを壊す。
 * docs/design/02-core-battle.md 2.11 を参照。
 */
const determinismRules = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message:
        'Math.random() は決定性を壊します。core/rng.ts の createRng(seed) を使ってください。',
    },
    {
      object: 'Date',
      property: 'now',
      message:
        'Date.now() は決定性を壊します。sim の時刻は GameClock (core/clock.ts) から取得してください。',
    },
    {
      object: 'performance',
      property: 'now',
      message:
        'performance.now() を sim から読まないでください。実時間を扱ってよいのは core/loop.ts だけです。',
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'sim では現在時刻を参照しないでください（GameClock を使う）。' },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      ...determinismRules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // 実時間・実乱数に触れてよいのはここだけ。
    // loop は requestAnimationFrame の実時間を GameClock へ供給する境界であり、
    // rng は seed 生成のために一度だけ実乱数を必要とする。
    files: ['src/core/loop.ts', 'src/core/rng.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
