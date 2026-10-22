import { describe, expect, it } from "vitest";
import { bandOutline, bandSection, lineSection } from "./bandSection";

// 10×10 画素・ピッチ 10µm。値 = 列番号（横方向に傾いた面）
const grid = Array.from({ length: 10 }, () =>
  Array.from({ length: 10 }, (_, c) => c as number | null)
);

describe("bandSection", () => {
  it("横向きの線・幅 20µm なら、線の行と上下1行ずつ（3行）の画素を集める", () => {
    const s = bandSection(grid, 10, 10, { y: 0, z: 50 }, { y: 90, z: 50 }, 20);
    expect(s.count).toBe(30);
    // 中央値の形は「距離 t に比例する」傾き（値 = t/10）
    s.profT.forEach((t, i) => expect(s.profMed[i]).toBeCloseTo(Math.floor(t / 10), 9));
  });

  it("欠損は数えず、帯の外の画素は入れない", () => {
    const g = grid.map((r) => [...r]);
    g[5][3] = null;
    g[0][3] = 999; // 帯の外
    const s = bandSection(g, 10, 10, { y: 0, z: 50 }, { y: 90, z: 50 }, 20);
    expect(s.count).toBe(29);
    expect(Math.max(...s.v)).toBeLessThan(999);
  });

  it("中央値はノイズ1画素に引きずられない", () => {
    const g = grid.map((r) => [...r]);
    g[5][4] = 1000;
    const s = bandSection(g, 10, 10, { y: 0, z: 50 }, { y: 90, z: 50 }, 20);
    const i = s.profT.findIndex((t) => Math.floor(t / 10) === 4);
    expect(s.profMed[i]).toBe(4);
  });

  it("線の長さが0なら空", () => {
    expect(bandSection(grid, 10, 10, { y: 5, z: 5 }, { y: 5, z: 5 }, 20).count).toBe(0);
  });
});

describe("bandOutline", () => {
  it("横向きの線なら上下に幅/2 ずつ広げた閉じた四角形", () => {
    const o = bandOutline({ y: 0, z: 50 }, { y: 90, z: 50 }, 20);
    expect(o.y).toEqual([0, 90, 90, 0, 0]);
    expect(o.z).toEqual([60, 60, 40, 40, 60]);
  });
});

describe("lineSection", () => {
  it("線に沿って双一次補間する（値 = 列番号の面なら、値 = 距離/ピッチ）", () => {
    const s = lineSection(grid, 10, 10, { y: 0, z: 25 }, { y: 90, z: 25 });
    expect(s.t.length).toBe(10);
    s.t.forEach((t, i) => expect(s.v[i]).toBeCloseTo(t / 10, 9));
  });

  it("斜めの線でも段々にならない（行・列とも補間）", () => {
    // 値 = 行番号 + 列番号 の面を対角に切る → 値は距離に比例して滑らかに増える
    const g = Array.from({ length: 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => r + c));
    const s = lineSection(g, 10, 10, { y: 0, z: 0 }, { y: 90, z: 90 });
    s.t.forEach((t, i) => expect(s.v[i]).toBeCloseTo((2 * t) / (10 * Math.SQRT2), 9));
  });

  it("欠損の所は null（線を切る）。周りの一部だけ欠損なら最寄りの画素", () => {
    const g = grid.map((r) => [...r]);
    for (let c = 4; c <= 6; c++) g[2][c] = g[3][c] = null;
    const s = lineSection(g, 10, 10, { y: 0, z: 25 }, { y: 90, z: 25 });
    expect(s.v[5]).toBeNull();
    expect(s.v[0]).toBeCloseTo(0);
  });
});
