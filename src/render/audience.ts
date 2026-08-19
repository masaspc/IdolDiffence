/**
 * 子ウサギの客席。**観客はゲージの数字ではなく、そこにいる。**
 *
 * ## なぜ要るのか
 *
 * 原作でかぐやのファンネームは「子ウサギ」（04-content.md 出典表）で、
 * 実績「満員御礼」も「子ウサギが満席」と書いてある。なのに画面には
 * 観客がひとりも描かれていなかった —— 同接ゲージが減るとき、
 * **誰が帰っているのか**が画面に見えない。
 *
 * センターステージ（経路の終端）の向こう側に子ウサギを扇形に並べ、
 * 同接に比例して席を埋める。敵を通すとゲージと一緒に席が空いていく。
 *
 * ## 決定的に並べる
 *
 * `Math.random()` は禁止（ESLint）。席の位置の揺らぎはレーン番号と
 * 席番号のハッシュから決める。同じステージなら毎回同じ客席になる。
 *
 * ## 描画の都合は renderer 側
 *
 * ここは**座標と数を決めるだけ**（DOM も Canvas も知らない）。
 * 「サビでペンライトが点く」「拍で揺れる」は renderer の仕事。
 * 分けてあるので、席の決め方は音や絵を出さずにテストできる。
 */

export interface Seat {
  /** セル座標（グリッド単位、小数）。中心は +0.5 */
  x: number;
  y: number;
  /** 拍で揺れるときの位相ずらし（0..1）。全員が同じ揺れだと機械になる */
  phase: number;
}

/** 1 つのゴールに置く席の数（前列 + 後列）。捨てられた席は戻さない */
const FRONT_SEATS = 6;
const BACK_SEATS = 8;

const hash = (n: number): number => (Math.imul(n, 2654435761) >>> 0) % 1000;

/**
 * 座らせないセルの集合（"x,y"）。**経路の上と配置マスの上には座らせない** ——
 * 経路は敵が歩き、配置マスはプレイヤーが押す場所で、どちらも
 * 客席が重なると読めなくなる（S28 の実データで経路 5 席・配置マス 10 席が
 * 重なっていた）。レーンは折れ線なので、ウェイポイント間を 1 セルずつ
 * 歩いて埋める。
 */
export function blockedCells(
  lanes: readonly { waypoints: readonly (readonly [number, number])[] }[],
  placeable: readonly (readonly [number, number])[],
): Set<string> {
  const blocked = new Set<string>();
  for (const [x, y] of placeable) blocked.add(`${x},${y}`);
  for (const lane of lanes) {
    for (let i = 0; i < lane.waypoints.length - 1; i++) {
      const from = lane.waypoints[i];
      const to = lane.waypoints[i + 1];
      if (!from || !to) continue;
      const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        blocked.add(`${Math.round(from[0] + (to[0] - from[0]) * t)},${Math.round(from[1] + (to[1] - from[1]) * t)}`);
      }
    }
  }
  return blocked;
}

/**
 * ゴールごとの席の列を 1 本に混ぜる。**前から順に埋める**前提の配列なので、
 * ゴール順に連結すると「最初のゴールだけ満席で残りは無人」になる
 * （S18 の 4 ゴールで実際にそうなった）。各ゴールの 1 席目、2 席目…と
 * 交互に取り、同接が減るとどのゴールからも同じくらいずつ帰るようにする。
 */
export function interleave<T>(groups: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i++) {
    for (const group of groups) {
      const item = group[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

/** ある向きに扇を開いたときの席。盤面の外と立入禁止セルの席は捨てる */
function fanSeats(
  gx: number,
  gy: number,
  center: number,
  gridW: number,
  gridH: number,
  laneIndex: number,
  blocked: ReadonlySet<string>,
): Seat[] {
  const seats: Seat[] = [];
  const rows: { count: number; radius: number }[] = [
    { count: FRONT_SEATS, radius: 1.15 },
    { count: BACK_SEATS, radius: 1.8 },
  ];
  let index = 0;
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const salt = hash(laneIndex * 131 + index * 7 + 1);
      // 扇の開き ±70°。等間隔 + 少しの揺らぎで「並ばされた感」を消す
      const spread = (i / (row.count - 1) - 0.5) * ((Math.PI / 180) * 140);
      const angle = center + spread + ((salt % 21) - 10) * 0.006;
      const radius = row.radius + ((salt % 13) - 6) * 0.02;
      const x = gx + Math.cos(angle) * radius;
      const y = gy + Math.sin(angle) * radius;
      index += 1;
      // 盤面の外・盤面の縁ぎりぎりは捨てる（描き切れない）
      if (x < 0.25 || y < 0.25 || x > gridW - 0.25 || y > gridH - 0.25) continue;
      // 経路・配置マスの上にも座らせない
      if (blocked.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
      seats.push({ x, y, phase: (salt % 100) / 100 });
    }
  }
  return seats;
}

/**
 * ゴールのまわりに扇形の客席を並べる。
 *
 * 第一候補は「敵が来る方向の先」—— ステージの前はその延長線上にある。
 * ただしゴールが盤面の端だと扇のほとんどが盤外に落ちる（S1 がそうで、
 * 客席が 2 席になった）。そのときは**左右の直交方向**にも扇を開いてみて、
 * 生き残った席がいちばん多い向きを選ぶ。敵の来た方向（経路の上）にだけは
 * 開かない —— 歩いてくる敵の足元に観客を座らせることになる。
 *
 * @param goal レーン終端のセル座標
 * @param prev 終端のひとつ手前のセル座標。無ければ真下向きとみなす
 * @param blocked 座らせないセル（`blockedCells`）。省略は空
 */
export function seatsAround(
  goal: readonly [number, number],
  prev: readonly [number, number] | null,
  gridW: number,
  gridH: number,
  laneIndex: number,
  blocked: ReadonlySet<string> = new Set(),
): Seat[] {
  const gx = goal[0] + 0.5;
  const gy = goal[1] + 0.5;
  let dx = 0;
  let dy = 1;
  if (prev) {
    const lx = goal[0] - prev[0];
    const ly = goal[1] - prev[1];
    const len = Math.hypot(lx, ly);
    if (len > 0) {
      dx = lx / len;
      dy = ly / len;
    }
  }
  const forward = Math.atan2(dy, dx);

  let best: Seat[] = [];
  for (const center of [forward, forward + Math.PI / 2, forward - Math.PI / 2]) {
    const candidate = fanSeats(gx, gy, center, gridW, gridH, laneIndex, blocked);
    // 先に並べた候補（前方）を優先。同数なら向きを変えない
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

/**
 * 同接に応じて埋まる席の数。前から順に埋める（描く側は配列の先頭から）。
 * 同接が残っているあいだは最後のひとりが残る —— 0 になった瞬間はライブ中断で、
 * 空の客席は結果画面ではなくカットインが伝える。
 */
export function filledCount(totalSeats: number, audience: number): number {
  if (totalSeats <= 0 || audience <= 0) return 0;
  return Math.max(1, Math.round((totalSeats * Math.min(100, audience)) / 100));
}
