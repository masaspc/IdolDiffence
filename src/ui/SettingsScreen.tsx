/**
 * 設定（06-ui-ux.md 6.7 アクセシビリティ）。
 *
 * **何が変わるかを、その場で読める文で書く。** 「演出強度: 控えめ」だけだと
 * 何が減るのか分からず、光過敏の人が選べない。止まるものを名指しする。
 */
import type { SaveData } from '../meta/save';
import {
  EFFECT_LABEL,
  type EffectLevel,
  type Settings,
  type TextScale,
} from '../meta/settings';

interface SettingsScreenProps {
  save: SaveData;
  onChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

const EFFECT_DESC: Record<EffectLevel, string> = {
  full: '点滅・画面揺れ・ダメージ表示をすべて出す',
  reduced: '画面揺れを止め、点滅を弱くする',
  minimal: '点滅・揺れ・ダメージ表示をすべて止める',
};

const TEXT_SCALES: TextScale[] = [100, 125, 150];

export function SettingsScreen({
  save,
  onChange,
  onBack,
}: SettingsScreenProps): React.JSX.Element {
  const settings = save.settings;

  return (
    <div className="home settings-screen">
      <header className="home-head">
        <div>
          <h1>設定</h1>
          <p className="home-sub">遊びやすさの調整 —— いつでも変えられます</p>
        </div>
        <button type="button" className="party-back" onClick={onBack}>
          ホームへ戻る
        </button>
      </header>

      <section className="party-summary">
        <h2>コール &amp; レスポンス</h2>
        <div className="setting-row">
          <div className="setting-text">
            <strong>{settings.call ? '自分で押す' : '自動（既定）'}</strong>
            <span className="party-hint">
              {settings.call
                ? 'サビ中、小節の頭に合わせて Space かマーカーを押します。Perfect で月華 +3 と全体攻撃力 +5%（3 秒）'
                : '押さなくても Good 相当が自動で入ります。有利不利はほとんどありません'}
            </span>
          </div>
          <button
            type="button"
            className={`setting-toggle${settings.call ? ' is-on' : ''}`}
            onClick={() => onChange({ call: !settings.call })}
            aria-pressed={settings.call}
          >
            {settings.call ? 'オン' : 'オフ'}
          </button>
        </div>
      </section>

      <section className="party-summary">
        <h2>演出の強さ</h2>
        <p className="party-hint">
          点滅と画面の揺れを段階的に落とせます（光過敏対策）。盤面の情報は減りません
        </p>
        <div className="setting-choices">
          {(Object.keys(EFFECT_LABEL) as EffectLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              className={`setting-choice${settings.effects === level ? ' is-on' : ''}`}
              onClick={() => onChange({ effects: level })}
              aria-pressed={settings.effects === level}
            >
              <strong>{EFFECT_LABEL[level]}</strong>
              <span>{EFFECT_DESC[level]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="party-summary">
        <h2>文字サイズ</h2>
        <p className="party-hint">画面全体の文字を大きくします。盤面の広さは変わりません</p>
        <div className="setting-choices">
          {TEXT_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={`setting-choice${settings.textScale === scale ? ' is-on' : ''}`}
              onClick={() => onChange({ textScale: scale })}
              aria-pressed={settings.textScale === scale}
            >
              <strong style={{ fontSize: `${scale}%` }}>{scale}%</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="party-summary">
        <h2>敵に属性の記号を出す</h2>
        <div className="setting-row">
          <div className="setting-text">
            <strong>{settings.attributeGlyphs ? '出す' : '出さない（既定）'}</strong>
            <span className="party-hint">
              静寂 / 喧噪 / 虚飾 を色だけでなく記号でも示します。
              メンバーの系統アイコン（♪ ★ ♥）は設定に関わらず常に出ます
            </span>
          </div>
          <button
            type="button"
            className={`setting-toggle${settings.attributeGlyphs ? ' is-on' : ''}`}
            onClick={() => onChange({ attributeGlyphs: !settings.attributeGlyphs })}
            aria-pressed={settings.attributeGlyphs}
          >
            {settings.attributeGlyphs ? 'オン' : 'オフ'}
          </button>
        </div>
      </section>

      <p className="settings-note">
        キーボードだけでも遊べます。数字キーで配置メンバーを選び、Q で月華の解放、
        P で一時停止、Tab で速度、Space でコール。
      </p>
    </div>
  );
}
