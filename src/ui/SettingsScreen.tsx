/**
 * 設定（06-ui-ux.md 6.7 アクセシビリティ）。
 *
 * **何が変わるかを、その場で読める文で書く。** 「演出強度: 控えめ」だけだと
 * 何が減るのか分からず、光過敏の人が選べない。止まるものを名指しする。
 */
import type { SaveData } from '../meta/save';
import {
  EFFECT_LABEL,
  volumeRatio,
  type EffectLevel,
  type Settings,
  type TextScale,
} from '../meta/settings';
import { resumeAudio } from '../audio/context';
import { playSe, setSeVolume } from '../audio/se';

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

      {/*
        音量。**試聴のボタンを付けない。** 動かした瞬間に SE が鳴るので、
        スライダーそのものが試聴になっている（BGM はバトル中に反映される）
      */}
      <section className="party-summary">
        <h2>音量</h2>
        <p className="party-hint">
          流れる音は<strong>本作が合成したオリジナル</strong>です。BPM と構成だけを
          原作の劇中歌に合わせています（原作の音源は使っていません）
        </p>
        <div className="setting-row">
          <div className="setting-text">
            <strong>BGM</strong>
            <span className="party-hint">
              和楽器の音でステージの曲を組み立てます。0 にすると合成そのものを止めます
            </span>
          </div>
          <div className="volume-control">
            <input
              type="range"
              min={0}
              max={10}
              value={settings.bgmVolume}
              onChange={(event) => onChange({ bgmVolume: Number(event.target.value) })}
              aria-label="BGM の音量"
            />
            <span className="volume-value">{settings.bgmVolume}</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <strong>効果音</strong>
            <span className="party-hint">配置・撃破・月華の解放など。動かすと試しに鳴ります</span>
          </div>
          <div className="volume-control">
            <input
              type="range"
              min={0}
              max={10}
              value={settings.seVolume}
              onChange={(event) => {
                const next = Number(event.target.value);
                onChange({ seVolume: next });
                // その場で聞こえないと、下げ過ぎたのか切れているのかが分からない
                resumeAudio();
                setSeVolume(volumeRatio(next));
                playSe('place');
              }}
              aria-label="効果音の音量"
            />
            <span className="volume-value">{settings.seVolume}</span>
          </div>
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

      {/*
        原作との関係をはっきりさせる場所。**ここが無いと楽曲名が誤解される。**
        ステージに出る曲名は原作の劇中歌そのものだが、鳴っている音は本作が
        合成した別物なので、その 1 点だけは必ず読める場所に置く
      */}
      <section className="party-summary">
        <h2>この作品について</h2>
        <p className="settings-note">
          Netflix 映画『超かぐや姫！』の<strong>非公式ファン制作</strong>です。
          権利は原作の権利者に帰属します。
        </p>
        <p className="settings-note">
          ステージの楽曲名は<strong>原作の劇中歌</strong>で、作曲者と歌唱もそのクレジットです。
          ただし<strong>流れている音は本作が合成したオリジナル</strong>で、
          クレジットの人が作った音ではありません。合わせているのは BPM と構成だけです。
          <strong>原作の音源は使っていません</strong> —— 原作の曲は Netflix と
          各配信サービスでお聴きください。
        </p>
        <p className="settings-note">
          ステージ・敵・数値・ドット絵は本作が作ったものです。
          S11 以降の敵は『竹取物語』の登場人物で、こちらは古典です。
        </p>
      </section>
    </div>
  );
}
