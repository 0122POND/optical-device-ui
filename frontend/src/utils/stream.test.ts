import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSerpentineOrder, simulatePointStream, type Point } from "./stream";

describe("buildSerpentineOrder", () => {
  it("偶数行は左→右、奇数行は右→左の蛇行順になる", () => {
    expect(buildSerpentineOrder(3)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 1],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
  });

  it("size=1 は1点、size=0 は空", () => {
    expect(buildSerpentineOrder(1)).toEqual([[0, 0]]);
    expect(buildSerpentineOrder(0)).toEqual([]);
  });

  it("全セルをちょうど1回ずつ通る", () => {
    const size = 7;
    const order = buildSerpentineOrder(size);
    expect(order).toHaveLength(size * size);
    const keys = new Set(order.map(([y, x]) => `${y},${x}`));
    expect(keys.size).toBe(size * size);
  });

  it("隣り合う点は常に隣接セル（走査ヘッドが飛ばない）", () => {
    const order = buildSerpentineOrder(5);
    for (let i = 1; i < order.length; i++) {
      const [y0, x0] = order[i - 1];
      const [y1, x1] = order[i];
      expect(Math.abs(y1 - y0) + Math.abs(x1 - x0)).toBe(1);
    }
  });
});

describe("simulatePointStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // stream.ts は window.setInterval を使う。node 環境なので globalThis を window に見立てる
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("null を飛ばして蛇行順にバッチ配信し、最後に onDone を呼ぶ", () => {
    const target: (number | null)[][] = [
      [1, null],
      [3, 4],
    ];
    const batches: Point[][] = [];
    const onDone = vi.fn();
    simulatePointStream(target, {
      intervalMs: 10,
      batchSize: 2,
      onBatch: (p) => batches.push(p),
      onDone,
    });

    vi.advanceTimersByTime(10);
    expect(batches).toEqual([
      [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 1, z: 4 },
      ],
    ]);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(batches[1]).toEqual([{ x: 0, y: 1, z: 3 }]);
    expect(onDone).toHaveBeenCalledTimes(1);

    // 完了後はタイマーが止まっている
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("返り値の関数で途中停止できる", () => {
    const target: (number | null)[][] = [
      [1, 2],
      [3, 4],
    ];
    const onBatch = vi.fn();
    const onDone = vi.fn();
    const stop = simulatePointStream(target, { intervalMs: 10, batchSize: 1, onBatch, onDone });

    vi.advanceTimersByTime(10);
    expect(onBatch).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(100);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
