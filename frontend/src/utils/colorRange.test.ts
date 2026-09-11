import { describe, expect, it } from "vitest";
import {
  buildClippedColorscale,
  colorForValue,
  COLOR_STOPS,
  OUT_OF_RANGE_COLOR,
  OUT_OF_RANGE_RGB,
  resolveColorRange,
  robustRange,
} from "./colorRange";

// 0..999 の一様データ。外れ値なしなので自動レンジは min/max のまま
const uniform = Array.from({ length: 1000 }, (_, i) => i);

describe("robustRange", () => {
  it("外れ値がなければ min/max をそのままレンジにする", () => {
    const r = robustRange(uniform);
    expect(r).toEqual({ lo: 0, hi: 999, min: 0, max: 999 });
  });

  it("外れ値でレンジが引き伸ばされている場合は 1〜99 パーセンタイルに切り替える", () => {
    const withOutlier = [...uniform, 100_000];
    const r = robustRange(withOutlier);
    expect(r.min).toBe(0);
    expect(r.max).toBe(100_000);
    // lo/hi は外れ値に引きずられず本体データの範囲に収まる
    expect(r.lo).toBeGreaterThanOrEqual(0);
    expect(r.lo).toBeLessThan(50);
    expect(r.hi).toBeGreaterThan(950);
    expect(r.hi).toBeLessThan(1000);
  });

  it("NaN / Infinity は無視する", () => {
    const r = robustRange([NaN, 1, Infinity, 2, -Infinity, 3]);
    expect(r).toEqual({ lo: 1, hi: 3, min: 1, max: 3 });
  });

  it("有限値がなければ 0〜1 のダミーレンジを返す", () => {
    expect(robustRange([])).toEqual({ lo: 0, hi: 1, min: 0, max: 1 });
    expect(robustRange([NaN, NaN])).toEqual({ lo: 0, hi: 1, min: 0, max: 1 });
  });

  it("全て同じ値でも NaN を出さない", () => {
    expect(robustRange([5, 5, 5])).toEqual({ lo: 5, hi: 5, min: 5, max: 5 });
  });

  it("型付き配列も受け付ける", () => {
    const r = robustRange(new Float32Array([3, 1, 2]));
    expect(r).toEqual({ lo: 1, hi: 3, min: 1, max: 3 });
  });
});

describe("resolveColorRange", () => {
  it("手動 min/max が両方あればそれを使う", () => {
    const r = resolveColorRange(uniform, "100", "200");
    expect(r.lo).toBe(100);
    expect(r.hi).toBe(200);
    // min/max はデータの生の値のまま
    expect(r.min).toBe(0);
    expect(r.max).toBe(999);
  });

  it("片側だけの指定は、もう片側を自動レンジで補う", () => {
    expect(resolveColorRange(uniform, "100", "")).toMatchObject({ lo: 100, hi: 999 });
    expect(resolveColorRange(uniform, "", "200")).toMatchObject({ lo: 0, hi: 200 });
  });

  it("両方空なら自動レンジ", () => {
    expect(resolveColorRange(uniform, "", "")).toMatchObject({ lo: 0, hi: 999 });
  });

  it("min >= max の不正入力は自動レンジにフォールバックする", () => {
    expect(resolveColorRange(uniform, "500", "100")).toMatchObject({ lo: 0, hi: 999 });
    expect(resolveColorRange(uniform, "500", "500")).toMatchObject({ lo: 0, hi: 999 });
  });

  it("数値に解釈できない文字列は空扱い", () => {
    expect(resolveColorRange(uniform, "abc", "200")).toMatchObject({ lo: 0, hi: 200 });
  });
});

describe("buildClippedColorscale", () => {
  it("レンジ外がなければグレー帯なしで cmin/cmax = lo/hi", () => {
    const out = buildClippedColorscale({ lo: 0, hi: 10, min: 0, max: 10 });
    expect(out.cmin).toBe(0);
    expect(out.cmax).toBe(10);
    expect(out.colorscale).toHaveLength(COLOR_STOPS.length);
    expect(out.colorscale[0]).toEqual([0, COLOR_STOPS[0][1]]);
    expect(out.colorscale.at(-1)).toEqual([1, COLOR_STOPS.at(-1)![1]]);
  });

  it("下側にレンジ外があれば先頭にグレー帯（幅5%）が付く", () => {
    const out = buildClippedColorscale({ lo: 0, hi: 100, min: -50, max: 100 });
    expect(out.cmin).toBeCloseTo(-5);
    expect(out.cmax).toBe(100);
    expect(out.colorscale[0]).toEqual([0, OUT_OF_RANGE_COLOR]);
    expect(out.colorscale[1][1]).toBe(OUT_OF_RANGE_COLOR);
    // グレー帯の終端 = lo の位置
    expect(out.colorscale[1][0]).toBeCloseTo(5 / 105);
  });

  it("上側にレンジ外があれば末尾にグレー帯が付く", () => {
    const out = buildClippedColorscale({ lo: 0, hi: 100, min: 0, max: 500 });
    expect(out.cmin).toBe(0);
    expect(out.cmax).toBeCloseTo(105);
    expect(out.colorscale.at(-1)).toEqual([1, OUT_OF_RANGE_COLOR]);
    expect(out.colorscale.at(-2)![1]).toBe(OUT_OF_RANGE_COLOR);
  });

  it("colorscale の位置は 0〜1 の範囲で単調非減少", () => {
    const out = buildClippedColorscale({ lo: 10, hi: 20, min: 0, max: 30 });
    const ts = out.colorscale.map(([t]) => t);
    expect(ts[0]).toBe(0);
    expect(ts.at(-1)).toBe(1);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
  });

  it("lo == hi でも NaN にならない", () => {
    const out = buildClippedColorscale({ lo: 5, hi: 5, min: 5, max: 5 });
    for (const [t] of out.colorscale) expect(Number.isFinite(t)).toBe(true);
  });
});

describe("colorForValue", () => {
  it("レンジ外はグレー", () => {
    expect(colorForValue(-1, 0, 10)).toEqual(OUT_OF_RANGE_RGB);
    expect(colorForValue(11, 0, 10)).toEqual(OUT_OF_RANGE_RGB);
  });

  it("下端は青、上端は赤、中央は緑", () => {
    expect(colorForValue(0, 0, 10)).toEqual([0, 0, 1]);
    expect(colorForValue(10, 0, 10)).toEqual([1, 0, 0]);
    expect(colorForValue(5, 0, 10)).toEqual([0, 1, 0]);
  });

  it("区間の途中は線形補間される（青→水色の中点）", () => {
    // t=0.125 は [0,0,255] と [0,191,255] の中点
    const [r, g, b] = colorForValue(1.25, 0, 10);
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(95.5 / 255);
    expect(b).toBeCloseTo(1);
  });

  it("lo == hi でも NaN にならない", () => {
    const c = colorForValue(5, 5, 5);
    for (const v of c) expect(Number.isFinite(v)).toBe(true);
  });
});
