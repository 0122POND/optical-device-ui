import { describe, expect, it } from "vitest";
import { densePointsFromGrid, sampledPointsFromGrid } from "./pointCloud";

describe("densePointsFromGrid", () => {
  it("x=高さ値, y=列, z=行, c=高さ値 にマッピングし null は飛ばす", () => {
    const grid: (number | null)[][] = [
      [10, null],
      [30, 40],
    ];
    expect(densePointsFromGrid(grid)).toEqual({
      x: [10, 30, 40],
      y: [0, 0, 1],
      z: [0, 1, 1],
      c: [10, 30, 40],
    });
  });

  it("高さ 0 は有効値として残す", () => {
    const out = densePointsFromGrid([[0, null]]);
    expect(out.x).toEqual([0]);
  });

  it("上限を超えると等間隔ストライドで間引く", () => {
    // 10×10 = 100 点、上限 25 → step = round(sqrt(4)) = 2 → 5×5 = 25 点
    const grid = Array.from({ length: 10 }, (_, r) =>
      Array.from({ length: 10 }, (_, c) => r * 10 + c)
    );
    const out = densePointsFromGrid(grid, 25);
    expect(out.x).toHaveLength(25);
    // 偶数行・偶数列だけが残る
    expect(out.y.every((v) => v % 2 === 0)).toBe(true);
    expect(out.z.every((v) => v % 2 === 0)).toBe(true);
  });

  it("上限以内なら間引かない", () => {
    const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 1));
    expect(densePointsFromGrid(grid, 100).x).toHaveLength(100);
  });

  it("空グリッドは空の点群", () => {
    expect(densePointsFromGrid([])).toEqual({ x: [], y: [], z: [], c: [] });
  });
});

describe("sampledPointsFromGrid", () => {
  const grid: (number | null)[][] = [
    [10, null, 12],
    [null, 21, 22],
  ];

  it("上限以内なら全有効点を行→列順で返し、c は x と同じ配列を共有する", () => {
    const out = sampledPointsFromGrid(grid, 100);
    expect(out).toEqual({
      x: [10, 12, 21, 22],
      y: [0, 2, 1, 2],
      z: [0, 0, 1, 1],
      c: [10, 12, 21, 22],
    });
    expect(out.c).toBe(out.x);
  });

  it("有効点がなければ空の点群", () => {
    expect(sampledPointsFromGrid([[null, null]], 10)).toEqual({ x: [], y: [], z: [], c: [] });
    expect(sampledPointsFromGrid([], 10)).toEqual({ x: [], y: [], z: [], c: [] });
  });

  it("上限ちょうどは間引かない", () => {
    expect(sampledPointsFromGrid(grid, 4).x).toEqual([10, 12, 21, 22]);
  });

  it("上限超過時は maxPoints 個に間引き、元の出現順に並ぶ", () => {
    // rng が常に 0 → 常にインデックス0を置換 → 最後の点が残り、順序復元で末尾に来る
    const out = sampledPointsFromGrid(grid, 3, () => 0);
    expect(out.x).toEqual([12, 21, 22]);
    expect(out.y).toEqual([2, 1, 2]);
    expect(out.z).toEqual([0, 1, 1]);
    expect(out.c).toBe(out.x);
  });

  it("rng が置換しない値を返し続ければ先頭 maxPoints 個が残る", () => {
    // j = floor(0.999 * (seen+1)) は seen >= maxPoints で常に >= maxPoints → 置換なし
    const out = sampledPointsFromGrid(grid, 3, () => 0.999);
    expect(out.x).toEqual([10, 12, 21]);
  });

  it("実乱数でも件数は上限に一致し、全て実在する点で出現順が単調増加", () => {
    const w = 50;
    const big = Array.from({ length: 40 }, (_, r) =>
      Array.from({ length: w }, (_, c) => r * w + c)
    );
    const max = 100;
    const out = sampledPointsFromGrid(big, max);
    expect(out.x).toHaveLength(max);
    for (let i = 0; i < max; i++) {
      // 値 = 行*w + 列 で生成しているので、座標と値の整合を確認
      expect(out.x[i]).toBe(out.z[i] * w + out.y[i]);
      if (i > 0) expect(out.x[i]).toBeGreaterThan(out.x[i - 1]);
    }
  });
});
