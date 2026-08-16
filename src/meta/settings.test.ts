/**
 * 設定（06-ui-ux.md 6.7 アクセシビリティ）。
 *
 * 見るのは**既定値**と、演出強度が実際に何を止めるか。
 * 設定画面を開かないまま遊ぶ人がいちばん多い、という前提で決めている。
 */
import { describe, expect, it } from 'vitest';
import {
  allowsFloatingText,
  allowsShake,
  DEFAULT_SETTINGS,
  flashAmount,
  textScaleRatio,
} from './settings';
import { createNewSave, migrate, saveSchema } from './save';

describe('既定値', () => {
  it('コールは切ってある（知らないまま遊んでも損をしない）', () => {
    expect(DEFAULT_SETTINGS.call).toBe(false);
    expect(createNewSave().settings.call).toBe(false);
  });

  it('文字サイズは 100%、演出は標準', () => {
    expect(DEFAULT_SETTINGS.textScale).toBe(100);
    expect(DEFAULT_SETTINGS.effects).toBe('full');
  });
});

describe('演出強度', () => {
  it('段階を落とすほど点滅が弱くなり、最小で完全に止まる', () => {
    expect(flashAmount('full')).toBe(1);
    expect(flashAmount('reduced')).toBeLessThan(1);
    expect(flashAmount('reduced')).toBeGreaterThan(0);
    expect(flashAmount('minimal')).toBe(0);
  });

  it('画面揺れは標準でだけ出す', () => {
    expect(allowsShake('full')).toBe(true);
    expect(allowsShake('reduced')).toBe(false);
    expect(allowsShake('minimal')).toBe(false);
  });

  it('浮遊ダメージ表示は最小でだけ止める', () => {
    // 控えめは「光の刺激を減らす」段階。情報まで落とすと盤面が読めなくなる
    expect(allowsFloatingText('full')).toBe(true);
    expect(allowsFloatingText('reduced')).toBe(true);
    expect(allowsFloatingText('minimal')).toBe(false);
  });
});

describe('文字サイズ', () => {
  it('%（100/125/150）を倍率へ直す', () => {
    expect(textScaleRatio(100)).toBe(1);
    expect(textScaleRatio(125)).toBe(1.25);
    expect(textScaleRatio(150)).toBe(1.5);
  });
});

describe('セーブ', () => {
  it('設定を持たない古いセーブは既定値で開く', () => {
    const v7 = { ...createNewSave(), version: 7 } as Record<string, unknown>;
    delete v7.settings;
    delete v7.stats;
    delete v7.claimedAchievements;
    delete v7.title;

    const parsed = saveSchema.safeParse(migrate(v7));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(parsed.data.stats.wins).toBe(0);
    expect(parsed.data.title).toBeNull();
  });

  it('壊れた設定値は弾いて作り直す（黙って通さない）', () => {
    const broken = { ...createNewSave(), settings: { ...DEFAULT_SETTINGS, textScale: 999 } };
    expect(saveSchema.safeParse(broken).success).toBe(false);
  });
});
