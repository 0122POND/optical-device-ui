import { describe, expect, it } from "vitest";
import { addNoise, generateCoinData } from "./surface";

describe("generateCoinData", () => {
  it("size×size の正方グリッドを返す", () => {
    const z = generateCoinData(21);
    expect(z).toHaveLength(21);
    for (const row of z) expect(row).toHaveLength(21);
  });

  it("円の外（四隅）は null、中心は高さ 0.1", () => {
    const z = generateCoinData(21);
    expect(z[0][0]).toBeNull();
    expect(z[0][20]).toBeNull();
    expect(z[20][0]).toBeNull();
    expect(z[20][20]).toBeNull();
    expect(z[10][10]).toBeCloseTo(0.1);
  });

  it("縁 (0.8 < r < 0.95) は中央より 0.15 高い", () => {
    const size = 201;
    const z = generateCoinData(size);
    const c = (size - 1) / 2;
    // r = 0.875 の位置（x軸上）
    const rimIdx = Math.round(c + 0.875 * c);
    const rimZ = z[c][rimIdx]!;
    const expectedBase = 0.1 * (1 - 0.875 * 0.875);
    expect(rimZ).toBeCloseTo(expectedBase + 0.15, 2);
    // r = 0.5 は縁ではない
    const midIdx = Math.round(c + 0.5 * c);
    expect(z[c][midIdx]).toBeCloseTo(0.1 * (1 - 0.25), 2);
  });

  it("中心対称（転置しても同じ）", () => {
    const size = 31;
    const z = generateCoinData(size);
    for (let i = 0; i < size; i++)
      for (let j = 0; j < size; j++) {
        if (z[i][j] === null) expect(z[j][i]).toBeNull();
        else expect(z[j][i]).toBeCloseTo(z[i][j]!);
      }
  });
});

describe("addNoise", () => {
  it("null は null のまま、振幅内に収まる", () => {
    const base: (number | null)[][] = [
      [1, null],
      [2, 3],
    ];
    const amp = 0.1;
    const out = addNoise(base, amp);
    expect(out[0][1]).toBeNull();
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const b = base[i][j];
        if (b === null) continue;
        expect(Math.abs(out[i][j]! - b)).toBeLessThanOrEqual(amp / 2);
      }
  });

  it("元配列を書き換えない", () => {
    const base: (number | null)[][] = [[1, 2]];
    addNoise(base);
    expect(base).toEqual([[1, 2]]);
  });

  it("ノイズで負になった点は null になる", () => {
    // z=0 に振幅を与えると約半分が負になり null 化される
    const base: (number | null)[][] = [Array.from({ length: 200 }, () => 0)];
    const out = addNoise(base, 1);
    const nulls = out[0].filter((v) => v === null).length;
    expect(nulls).toBeGreaterThan(50);
    expect(nulls).toBeLessThan(150);
    for (const v of out[0]) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
  });
});
