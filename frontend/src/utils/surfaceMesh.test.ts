import { describe, expect, it } from "vitest";
import {
  buildTriangleIndex,
  detrendHeights,
  gridToHeights,
  niceStep,
  percentileOf,
} from "./surfaceMesh";

describe("gridToHeights", () => {
  it("null を NaN にして行優先で並べる", () => {
    const { z, w, h } = gridToHeights([
      [1, null],
      [3, 4],
    ]);
    expect([w, h]).toEqual([2, 2]);
    expect(z[0]).toBe(1);
    expect(Number.isNaN(z[1])).toBe(true);
    expect(z[3]).toBe(4);
  });
});

describe("detrendHeights", () => {
  it("平面除去で傾いた平面がほぼ 0 になり、欠損は NaN のまま", () => {
    const w = 20,
      h = 15;
    const z = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) z[r * w + c] = 5 + 2 * c - 3 * r;
    z[7] = NaN;
    const out = detrendHeights(z, w, h, "plane");
    expect(Number.isNaN(out[7])).toBe(true);
    for (let i = 0; i < out.length; i++) if (i !== 7) expect(Math.abs(out[i])).toBeLessThan(1e-3);
  });

  it("2次曲面除去ですり鉢がほぼ 0 になる", () => {
    const w = 30,
      h = 30;
    const z = new Float32Array(w * h);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) z[r * w + c] = (c - 15) ** 2 + (r - 15) ** 2;
    const out = detrendHeights(z, w, h, "quad");
    for (const v of out) expect(Math.abs(v)).toBeLessThan(1e-2);
  });

  it("none は値を変えない（コピーを返す）", () => {
    const z = new Float32Array([1, 2, 3, 4]);
    const out = detrendHeights(z, 2, 2, "none");
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(z);
  });
});

describe("buildTriangleIndex", () => {
  it("全点有効の 2×2 は三角形 2 枚", () => {
    expect(buildTriangleIndex(new Float32Array([0, 0, 0, 0]), 2, 2)).toHaveLength(6);
  });

  it("1点欠損なら残り3点で三角形 1 枚、2点欠損なら 0 枚", () => {
    expect(buildTriangleIndex(new Float32Array([NaN, 0, 0, 0]), 2, 2)).toHaveLength(3);
    expect(buildTriangleIndex(new Float32Array([NaN, NaN, 0, 0]), 2, 2)).toHaveLength(0);
  });
});

describe("percentileOf / niceStep", () => {
  it("NaN を除いてパーセンタイルを取る", () => {
    const a = new Float32Array([NaN, 1, 2, 3, 4, NaN]);
    expect(percentileOf(a, 0)).toBe(1);
    expect(percentileOf(a, 100)).toBe(4);
  });

  it("1, 2, 5 刻みに丸める", () => {
    expect(niceStep(0.13)).toBeCloseTo(0.1);
    expect(niceStep(2.7)).toBe(2);
    expect(niceStep(6)).toBe(5);
    expect(niceStep(80)).toBe(100);
  });
});
