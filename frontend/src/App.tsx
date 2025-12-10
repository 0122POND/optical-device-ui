import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import "./App.css";

// 立体っぽい「山」を作るためのサンプル関数
function generateHillData(size = 50) {
  const zData: number[][] = [];

  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      // x, y を -1 〜 1 の範囲に正規化
      const x = (i / (size - 1)) * 2 - 1;
      const y = (j / (size - 1)) * 2 - 1;

      // 真ん中に山が1つあるような形（ガウスっぽい）
      const r = Math.sqrt(x * x + y * y);
      const z = Math.exp(-4 * r * r); // r が大きいほど高さが下がる

      row.push(z);
    }
    zData.push(row);
  }

  return zData;
}

// 新規：10円玉っぽい円盤
function generateCoinData(size = 120) {
  const zData: (number | null)[][] = [];

  for (let i = 0; i < size; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < size; j++) {
      const x = (i / (size - 1)) * 2 - 1;
      const y = (j / (size - 1)) * 2 - 1;

      const r = Math.sqrt(x * x + y * y);

      if (r > 1) {
        row.push(null);
        continue;
      }

      let z = 0;

      z += 0.1 * (1 - r * r); // 中央のふくらみ

      const rimInner = 0.8;
      const rimOuter = 0.95;
      if (r > rimInner && r < rimOuter) {
        z += 0.15; // 縁
      }

      row.push(z);
    }
    zData.push(row);
  }

  return zData;
}

// ノイズを加える関数
function addNoise(zData: number[][], amplitude = 0.05) {
  return zData.map(row =>
    row.map(z => z + (Math.random() - 0.5) * amplitude)
  );
}

function App() {
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!plotRef.current) return;

    // 簡単なサンプル高さデータ（3x3 のグリッド）
    let zData = generateCoinData(80);
    zData = addNoise(zData as number[][], 0.03); // 0.1 はノイズ量、後で調整できる

    // 型はいったん "any" 扱いでOK
    const data = [
      {
        z: zData,
        type: "surface" as const,
      },
    ];

    const layout = {
      title: "Sample 3D Surface",
      autosize: true,
      scene: {
        xaxis: { title: "X" },
        yaxis: { title: "Y" },
        zaxis: { title: "Height" },
      },
    };

    // TypeScript に「細かい型は気にしないでOK」と教える
    Plotly.newPlot(plotRef.current, data as any, layout as any);

    return () => {
      if (plotRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div ref={plotRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export default App;
