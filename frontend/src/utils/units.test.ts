import { describe, expect, it } from "vitest";
import {
  deviceFlipRef,
  gridScale,
  parsePitchFromFilename,
  physicalGrid,
  physicalPoints,
  pitchFilename,
  pointsInCsvUnits,
  type ScaleInputs,
} from "./units";

const S: ScaleInputs = {
  umPerPixelX: 1.8,
  umPerPixelY: 20,
  sweepInterval: "100",
  csvPitchX: 37.4,
  csvPitchY: 37.4,
};

describe("gridScale", () => {
  it("device: 値=µm/px(X)、列=µm/px(Y)、行=掃引間隔", () => {
    expect(gridScale("device", S)).toEqual({ value: 1.8, col: 20, row: 100, rowAssumed: false });
  });

  it("device: 掃引間隔が空なら行は µm/px(Y) を仮定値として使う", () => {
    expect(gridScale("device", { ...S, sweepInterval: "" })).toMatchObject({
      row: 20,
      rowAssumed: true,
    });
  });

  it("csv: 値はそのまま µm、列・行は CSV のピッチ", () => {
    expect(gridScale("csv", S)).toEqual({ value: 1, col: 37.4, row: 37.4, rowAssumed: false });
  });
});

describe("physicalGrid", () => {
  const grid = [
    [100, 200, null],
    [300, 400, 500],
  ];

  it("回帰: CSV の高さに X軸 µm/pix(1.8) を掛けない", () => {
    const pg = physicalGrid(grid, "csv", S, false);
    expect(pg.z).toEqual(grid);
    expect(pg.x).toEqual([0, 37.4, 74.8]);
    expect(pg.y).toEqual([0, 37.4]);
    expect(pg.zLabel).toBe("Height [µm]");
  });

  it("device: 重心px × 1.8、列×20、行×掃引間隔", () => {
    const pg = physicalGrid(grid, "device", S, false);
    expect(pg.z[0][0]).toBeCloseTo(180);
    expect(pg.z[1][2]).toBeCloseTo(900);
    expect(pg.z[0][2]).toBeNull();
    expect(pg.x).toEqual([0, 20, 40]);
    expect(pg.y).toEqual([0, 100]);
  });

  it("device の左右反転は深さを基準値から反転する", () => {
    const pg = physicalGrid(grid, "device", S, true, 500);
    expect(pg.z[0][0]).toBeCloseTo((500 - 100) * 1.8);
    expect(pg.z[1][2]).toBeCloseTo(0);
  });

  it("csv の左右反転は列の鏡映（高さは反転しない）", () => {
    const pg = physicalGrid(grid, "csv", S, true);
    expect(pg.z).toEqual([
      [null, 200, 100],
      [500, 400, 300],
    ]);
  });

  it("行ピッチが仮定値のときは軸ラベルで知らせる", () => {
    expect(physicalGrid(grid, "device", { ...S, sweepInterval: "" }, false).yLabel).toContain(
      "仮定値"
    );
  });
});

describe("deviceFlipRef", () => {
  it("グリッドの最大値を使う（点群の生の画素ではなく）", () => {
    const cloud = { x: [999], y: [0], z: [0], c: [0] };
    expect(deviceFlipRef([[1, 7, null]], cloud)).toBe(7);
  });

  it("グリッドが無ければ点群xの最大値、どちらも無ければ0", () => {
    expect(deviceFlipRef(null, { x: [3, 9], y: [0, 0], z: [0, 0], c: [0, 0] })).toBe(9);
    expect(deviceFlipRef(null, null)).toBe(0);
  });
});

describe("physicalPoints", () => {
  const cloud = { x: [10, 20], y: [0, 3], z: [1, 2], c: [0, 0] };

  it("device: x×1.8、y×20、z×掃引間隔", () => {
    const p = physicalPoints(cloud, "device", S, false);
    expect(p.xs[1]).toBeCloseTo(36);
    expect(p.ys).toEqual([0, 60]);
    expect(p.zs).toEqual([100, 200]);
  });

  it("csv: x(高さ)はそのまま、y・z は CSV ピッチ、反転は列の鏡映", () => {
    const p = physicalPoints(cloud, "csv", S, true);
    expect(p.xs).toEqual([10, 20]);
    expect(p.ys[0]).toBeCloseTo(3 * 37.4);
    expect(p.ys[1]).toBeCloseTo(0);
    expect(p.zs[1]).toBeCloseTo(2 * 37.4);
  });
});

describe("ピッチのファイル名埋め込み", () => {
  it("書き出し名と読み取りが往復する", () => {
    const name = pitchFilename("10円表_stitched.csv", 37.4, 100);
    expect(name).toBe("10円表_stitched_pitch37.4x100um.csv");
    expect(parsePitchFromFilename(name)).toEqual({ x: 37.4, y: 100 });
  });

  it("再書き出しで古いピッチ表記を重ねない", () => {
    expect(pitchFilename("a_pitch10x10um.csv", 20, 30)).toBe("a_pitch20x30um.csv");
  });

  it("ピッチ表記が無ければ null", () => {
    expect(parsePitchFromFilename("surface.csv")).toBeNull();
  });
});

describe("pointsInCsvUnits", () => {
  const cloud = { x: [10, 20], y: [0, 3], z: [1, 2], c: [10, 20] };

  it("device: 高さ=重心px×1.8µm、列・行は添字のまま（ピッチはファイル名へ）", () => {
    const p = pointsInCsvUnits(cloud, "device", S, false);
    expect(p.x[0]).toBeCloseTo(18);
    expect(p.x[1]).toBeCloseTo(36);
    expect(p.y).toEqual([0, 3]);
    expect(p.z).toEqual([1, 2]);
  });

  it("device の左右反転は深さを基準値から反転", () => {
    const p = pointsInCsvUnits(cloud, "device", S, true, 30);
    expect(p.x[0]).toBeCloseTo(36);
    expect(p.x[1]).toBeCloseTo(18);
  });

  it("csv: 高さはそのまま、左右反転は列の鏡映", () => {
    const p = pointsInCsvUnits(cloud, "csv", S, true);
    expect(p.x).toEqual([10, 20]);
    expect(p.y).toEqual([3, 0]);
  });
});
