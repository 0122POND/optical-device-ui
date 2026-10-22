import { describe, expect, it } from "vitest";
import { decimateForDisplay } from "./displayGrid";

describe("decimateForDisplay", () => {
  const x = [0, 10, 20, 30];
  const y = [0, 10, 20, 30];

  it("上限以内なら間引かずそのまま返す", () => {
    const z = [
      [1, 2],
      [3, 4],
    ];
    const d = decimateForDisplay([0, 1], [0, 1], z, null, 10);
    expect(d.stride).toBe(1);
    expect(d.z).toBe(z);
  });

  it("ブロック先頭の値を代表にし、先頭が欠損ならブロック内の最初の有効値（平均しない）", () => {
    const z = [
      [1, 2, null, 7],
      [3, 4, 8, 9],
      [null, null, 5, 6],
      [null, 10, 11, 12],
    ];
    const mask = z.map((r) => r.map((v) => v === 8 || v === 10));
    const d = decimateForDisplay(x, y, z, mask, 4); // 16セル → 2×2 ブロック
    expect(d.stride).toBe(2);
    expect(d.x).toEqual([0, 20]);
    expect(d.y).toEqual([0, 20]);
    expect(d.z).toEqual([
      [1, 7],
      [10, 5],
    ]);
    expect(d.mask).toEqual([
      [false, false],
      [true, false],
    ]);
  });

  it("ブロック全体が欠損なら欠損のまま", () => {
    const z = [
      [null, null, 1, 1],
      [null, null, 1, 1],
    ];
    expect(decimateForDisplay(x, [0, 10], z, null, 2).z).toEqual([[null, 1]]);
  });
});
