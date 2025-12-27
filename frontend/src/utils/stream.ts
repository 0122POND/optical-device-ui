// src/utils/stream.ts
export type Point = { x: number; y: number; z: number | null };

export function buildSerpentineOrder(size: number): Array<[number, number]> {
  const order: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < size; x++) order.push([y, x]);
    } else {
      for (let x = size - 1; x >= 0; x--) order.push([y, x]);
    }
  }
  return order;
}

/**
 * target(完成形のzグリッド)を「計測で点が届く」っぽく分割して送る擬似ストリーム。
 * 将来はここを WebSocket/HTTP/AI推論などの “実データソース” に差し替える。
 */
export function simulatePointStream(
  target: (number | null)[][],
  opts: {
    intervalMs?: number;
    batchSize?: number;
    onBatch: (points: Point[]) => void;
    onDone?: () => void;
  }
): () => void {
  const size = target.length;
  const intervalMs = opts.intervalMs ?? 30;
  const batchSize = opts.batchSize ?? 200;

  const order = buildSerpentineOrder(size).filter(([y, x]) => target[y][x] != null);
  let idx = 0;

  const timer = window.setInterval(() => {
    const points: Point[] = [];
    for (let k = 0; k < batchSize && idx < order.length; k++, idx++) {
      const [y, x] = order[idx];
      points.push({ x, y, z: target[y][x] });
    }

    if (points.length) opts.onBatch(points);

    if (idx >= order.length) {
      window.clearInterval(timer);
      opts.onDone?.();
    }
  }, intervalMs);

  return () => window.clearInterval(timer);
}
