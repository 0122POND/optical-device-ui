import { describe, expect, it } from "vitest";
import {
  applyPostprocess,
  interpolateScan,
  orientFilled,
  POST_OFF,
  removeOutliersLocal,
  removeOutliersMAD,
} from "./postprocess";

// 1列だけのグリッド（行=走査方向）
const col = (vals: (number | null)[]) => vals.map((v) => [v]);
const flat = (g: (number | null)[][]) => g.map((r) => r[0]);

describe("removeOutliersMAD", () => {
  it("中央値から MAD×1.4826×σ を超える点だけ欠損にする", () => {
    // 中央値 10、MAD 1 → 3σ の閾値は 4.4478
    const g = col([9, 10, 11, 10, 9, 11, 10, 30, null]);
    const r = removeOutliersMAD(g, 3);
    expect(r.median).toBe(10);
    expect(r.threshold).toBeCloseTo(3 * 1.4826);
    expect(r.removed).toBe(1);
    expect(flat(r.grid)).toEqual([9, 10, 11, 10, 9, 11, 10, null, null]);
  });
});

describe("removeOutliersLocal", () => {
  // 1行 40画素: 段差（705→725）＋小さなノイズ＋スパイク1点
  const row = Array.from({ length: 40 }, (_, c) => (c < 20 ? 705 : 725) + Math.sin(c * 7.3) * 0.5);
  row[30] += 40;

  it("行の中で突き出た点だけを外し、段差の縁は残す", () => {
    const g = Array.from({ length: 5 }, () => [...row]);
    const r = removeOutliersLocal(g, 3);
    expect(r.removed).toBe(5);
    expect(r.grid[0][30]).toBeNull();
    expect(r.grid[0][19]).not.toBeNull();
    expect(r.grid[0][20]).not.toBeNull();
  });

  it("行ごとの段差（横縞）は外さない（上下の行は窓に入れない）", () => {
    // スパイクを除いた行を、1行おきに 15 ずらす
    const clean = row.map((v, c) => (c === 30 ? v - 40 : v));
    const g = Array.from({ length: 6 }, (_, r) => clean.map((v) => v + (r % 2 ? 15 : 0)));
    expect(removeOutliersLocal(g, 3).removed).toBe(0);
  });
});

describe("interpolateScan", () => {
  it("3行以下のギャップは線形で埋め、印を付ける", () => {
    const r = interpolateScan(col([0, null, null, null, 4]));
    expect(flat(r.grid)).toEqual([0, 1, 2, 3, 4]);
    expect(r.filled.map((x) => x[0])).toEqual([false, true, true, true, false]);
    expect(r.linear).toBe(3);
  });

  it("4〜8行は局所スプライン（直線上の点なら直線になる）", () => {
    const vals: (number | null)[] = [0, 1, 2, null, null, null, null, 7, 8, 9];
    const r = interpolateScan(col(vals));
    flat(r.grid).forEach((v, i) => expect(v).toBeCloseTo(i, 9));
    expect(r.spline).toBe(4);
  });

  it("9行以上のギャップと、有効データの外側は埋めない", () => {
    const vals: (number | null)[] = [null, 0, ...Array(9).fill(null), 10, null];
    const r = interpolateScan(col(vals));
    expect(flat(r.grid)).toEqual(vals);
    expect(r.skipped).toBe(9);
  });

  it("スプラインが近傍の値の範囲から外れるときは線形にする", () => {
    // ギャップ前後で急に傾きが変わる → 自然スプラインがはみ出す
    const vals: (number | null)[] = [0, 0, 0, 0, 0, null, null, null, null, 100, 0, 0];
    const r = interpolateScan(col(vals));
    const g = flat(r.grid) as number[];
    for (let i = 5; i <= 8; i++) expect(g[i]).toBeCloseTo(((i - 4) / 5) * 100);
    expect(r.linear).toBe(4);
  });
});

describe("applyPostprocess", () => {
  it("外れ値除去 → 補間 の順に掛け、外した点も補間で埋まる", () => {
    const g = col([10, 10, 10, 50, 10, 10, 10]);
    const r = applyPostprocess(g, {
      removeOutliers: true,
      sigma: 3,
      outlierBase: "global",
      interpolate: true,
    });
    expect(r.removed).toBe(1);
    expect(flat(r.grid)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(r.filled?.[3][0]).toBe(true);
  });

  it("全部切なら元のまま", () => {
    const g = col([1, null, 3]);
    const r = applyPostprocess(g, POST_OFF);
    expect(r.grid).toBe(g);
    expect(r.filled).toBeNull();
  });
});

describe("orientFilled", () => {
  it("CSV の左右反転では列を逆順にする（デバイスは向きが変わらない）", () => {
    const f = [[true, false, false]];
    expect(orientFilled(f, "csv", true)).toEqual([[false, false, true]]);
    expect(orientFilled(f, "device", true)).toBe(f);
    expect(orientFilled(null, "csv", true)).toBeNull();
  });
});
