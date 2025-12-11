import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import "./App.css";

// 10円玉っぽい円盤
function generateCoinData(size = 120): (number | null)[][] {
  const zData: (number | null)[][] = [];

  for (let i = 0; i < size; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < size; j++) {
      const x = (i / (size - 1)) * 2 - 1;
      const y = (j / (size - 1)) * 2 - 1;

      const r = Math.sqrt(x * x + y * y);

      // 半径 1 より外側は「データなし」にする
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

// ノイズを加える（null はそのまま残す）
function addNoise(
  zData: (number | null)[][],
  amplitude = 0.05
): (number | null)[][] {
  return zData.map(row =>
    row.map(z =>
      z === null ? null : z + (Math.random() - 0.5) * amplitude
    )
  );
}

function App() {
  const plotRef = useRef<HTMLDivElement | null>(null);

  // 軸表示フラグ（true = 表示 / false = 非表示）
  const [axisVisible, setAxisVisible] = useState(true);

  useEffect(() => {
    if (!plotRef.current) return;

    // データ生成
    let zData = generateCoinData(80);
    zData = addNoise(zData, 0.1);

    const data = [
      {
        z: zData,
        type: "surface" as const,
      },
    ];

    const layout = {
      title: "Sample 3D Coin-like Surface",
      autosize: true,
      scene: {
        xaxis: {
          title: axisVisible ? "X" : "",
          visible: axisVisible,
          showgrid: axisVisible,
          zeroline: axisVisible,
        },
        yaxis: {
          title: axisVisible ? "Y" : "",
          visible: axisVisible,
          showgrid: axisVisible,
          zeroline: axisVisible,
        },
        zaxis: {
          title: axisVisible ? "Height" : "",
          visible: axisVisible,
          showgrid: axisVisible,
          zeroline: axisVisible,
        },
      },
    };

    // 軸表示フラグが変わるたびに再描画
    Plotly.newPlot(plotRef.current, data as any, layout as any);

    return () => {
      if (plotRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, [axisVisible]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 上部にボタンエリア */}
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <button onClick={() => setAxisVisible(v => !v)}>
          {axisVisible ? "軸を非表示にする" : "軸を表示する"}
        </button>
      </div>

      {/* 下にグラフエリア */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
        }}
      >
        <div ref={plotRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

export default App;
