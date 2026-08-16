/**
 * 2D ベクトル。
 *
 * フレーム内のアロケーションを避けるため、ホットパスでは out 引数付きの
 * mutate 系（`setV` / `addV` など）を使い、オブジェクトを使い回す。
 * docs/design/05-architecture.md 5.9 参照。
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export function setV(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copyV(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function addV(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function subV(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scaleV(out: Vec2, a: Vec2, k: number): Vec2 {
  out.x = a.x * k;
  out.y = a.y * k;
  return out;
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 射程判定はこれを使う。平方根を避けられる */
export function withinRange(a: Vec2, b: Vec2, range: number): boolean {
  return distanceSq(a, b) <= range * range;
}

export function normalize(out: Vec2, a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (len === 0) return setV(out, 0, 0);
  return setV(out, a.x / len, a.y / len);
}

export function lerpV(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
