/**
 * タイトル。**ツクヨミへ「接続」してから始める。**
 *
 * ## なぜ 1 枚挟むのか
 *
 * 原作のツクヨミは仮想空間で、みんな**接続して**入る。いきなりホームの一覧が
 * 出るのは「管理画面」であって、あの世界の入り方ではない。
 * 常夜の空とミラーボールを 1 枚見せて、タップで入場する。
 *
 * ## 音の解錠を兼ねる
 *
 * ブラウザはユーザー操作まで音を止める（`audio/context.ts`）。
 * 「タップして接続」は**必ず最初の操作になる**ので、ここで確実に音が起き、
 * ホームの BGM が黙って始められる。演出の都合と技術の都合が同じ場所で解ける。
 *
 * ## 毎回出す
 *
 * スキップ保存はしない。1 タップで抜けられる軽さにしてあるし、
 * 保存すると「音の解錠に必ず操作が挟まる」保証が消える。
 */
import { resumeAudio } from '../audio/context';

interface TitleScreenProps {
  onEnter: () => void;
}

export function TitleScreen({ onEnter }: TitleScreenProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="title-screen"
      onClick={() => {
        // ユーザー操作のハンドラの中。ここなら Safari / iOS でも起きる
        resumeAudio();
        onEnter();
      }}
    >
      {/* ツクヨミの空。月の代わりのミラーボール（原作） */}
      <span className="title-ball" aria-hidden="true">
        <span className="title-ball-shine" />
      </span>
      <span className="title-sparkles" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>

      <span className="title-work">超かぐや姫！</span>
      <span className="title-name">IDOL DIFFENCE</span>
      <span className="title-enter">タップしてツクヨミへ接続</span>

      <span className="title-note">
        非公式ファン制作 ／ 権利は原作の権利者に帰属します ／ 音は本作のオリジナル合成
      </span>
    </button>
  );
}
