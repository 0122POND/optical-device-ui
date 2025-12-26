// src/utils/surface.ts

// 10円玉っぽい円盤
export function generateCoinData(size = 120): (number | null)[][] {
    const zData: (number | null)[][] = [];
  
    for (let i = 0; i < size; i++) {
      const row: (number | null)[] = [];
      for (let j = 0; j < size; j++) {
        const x = (i / (size - 1)) * 2 - 1;
        const y = (j / (size - 1)) * 2 - 1;
  
        const r = Math.sqrt(x * x + y * y);
  
        // 半径 1 より外側は「データなし」
        if (r > 1) {
          row.push(null);
          continue;
        }
  
        let z = 0;
  
        // 中央のふくらみ
        z += 0.1 * (1 - r * r);
  
        // 縁
        const rimInner = 0.8;
        const rimOuter = 0.95;
        if (r > rimInner && r < rimOuter) {
          z += 0.15;
        }
  
        row.push(z);
      }
      zData.push(row);
    }
  
    return zData;
  }
  
  export function addNoise(
    zData: (number | null)[][],
    amplitude = 0.05
  ): (number | null)[][] {
    return zData.map((row) =>
      row.map((z) => {
        if (z === null) return null;
  
        const noisy = z + (Math.random() - 0.5) * amplitude;
  
        // z < 0 は描画しない（null扱い）
        return noisy < 0 ? null : noisy;
      })
    );
  }
  