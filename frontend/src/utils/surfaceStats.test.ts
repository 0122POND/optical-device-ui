import { describe, expect, it } from "vitest";
import { heightStats, validRates } from "./surfaceStats";

describe("validRates", () => {
  it("全体・中央50%×50%・中央面積50% を領域ごとに数える", () => {
    // 8×8 のうち外周2画素の枠だけ欠損 → 中央4×4 は全部有効
    const g = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => (r < 2 || r > 5 || c < 2 || c > 5 ? null : 1))
    );
    const v = validRates(g);
    expect(v.full).toBeCloseTo(16 / 64);
    expect(v.center50).toBeCloseTo(1); // 中央 4×4
    // 中央面積50%: 各軸 √0.5 ≒ 70.7% → 行・列とも 1〜6（6×6）、うち有効 4×4
    expect(v.centerArea50).toBeCloseTo(16 / 36);
  });

  it("空なら 0", () => {
    expect(validRates([])).toEqual({ full: 0, center50: 0, centerArea50: 0 });
  });
});

describe("heightStats", () => {
  const x = [0, 10, 20, 30];
  const y = [0, 10, 20];

  it("傾いた平面は平面除去後の Sq・Sa がほぼ 0", () => {
    const z = y.map((yy) => x.map((xx) => 5 + 0.1 * xx - 0.2 * yy));
    const s = heightStats(z, x, y)!;
    expect(s.count).toBe(12);
    expect(s.sq).toBeLessThan(1e-9);
    expect(s.sa).toBeLessThan(1e-9);
    expect(s.min).toBeCloseTo(5 - 4);
    expect(s.max).toBeCloseTo(5 + 3);
  });

  it("平面に ±1 の凹凸を乗せると Sa=1・Sq=1、欠損は数えない", () => {
    const z: (number | null)[][] = y.map((_, r) => x.map((_, c) => ((r + c) % 2 === 0 ? 1 : -1)));
    z[0][0] = null; // 欠損
    const s = heightStats(z, x, y)!;
    expect(s.count).toBe(11);
    expect(s.sa).toBeCloseTo(1, 1);
    expect(s.sq).toBeCloseTo(1, 1);
  });

  it("有効点が少なすぎれば null", () => {
    expect(heightStats([[1, null]], [0, 1], [0])).toBeNull();
  });
});
