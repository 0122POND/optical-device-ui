import { describe, expect, it } from "vitest";
import type { CloudHistoryEntry } from "../types";
import { decodeData, decodeGrid, encodeData, encodeGrid } from "./historyStore";

const cloud = { x: [1.23456789, 2], y: [0, 1], z: [0, 0], c: [10, 20] };
const base = {
  cloud,
  plotType: "surface" as const,
  dataSource: "csv" as const,
  dataName: "a.csv",
  processing: null,
  measuredAt: "2026/10/22 10:00:00",
  points: 2,
  thumbnail: "",
  name: "",
  source: "csv" as const,
};

describe("historyStore の保存形式", () => {
  it("高さマップは欠損と値（桁も）をそのまま往復できる", () => {
    const g = [
      [682.3456789012, null],
      [null, -1e-9],
    ];
    expect(decodeGrid(encodeGrid(g))).toEqual(g);
  });

  it("CSV由来は高さマップを二重に持たず、戻すと出どころの高さマップも同じ内容になる", () => {
    const grid = [[1, 2]];
    const e: CloudHistoryEntry = { ...base, grid, origin: { kind: "csv", grid } };
    const d = encodeData(e);
    expect(d.origin).toEqual({ kind: "csv", sameAsGrid: true });
    const back = decodeData(d);
    expect(back.grid).toEqual(grid);
    expect(back.origin).toEqual({ kind: "csv", grid });
    expect(back.cloud).toEqual(cloud);
  });

  it("フォルダ由来は画像を取り直さないよう、層ごとの点だけを残した snapshot になる", () => {
    const layers = { x: [5], y: [6], z: [7], c: [5] };
    const e: CloudHistoryEntry = {
      ...base,
      dataSource: "device",
      grid: null,
      origin: {
        kind: "folder",
        src: { folderUrl: "/data/result", threshold: 128, colorMode: "depth" },
        layers,
      } as unknown as CloudHistoryEntry["origin"],
    };
    expect(decodeData(encodeData(e)).origin).toEqual({ kind: "snapshot", layers });
  });
});
