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
        // ★ カラーバーを少し左に寄せて & 細くする
        colorbar: {
          x: 0.9,      // 0〜1 の相対位置（デフォルトより左）
          thickness: 15,
        },
      },
    ];

    const layout = {
      title: "Sample 3D Coin-like Surface",
      autosize: true,
      // 右も少しだけ余裕を持たせておく（なくてもいいけど一応）
      margin: {
        l: 0,
        r: 80,
        t: 40,
        b: 40,
      },
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
        display: "flex",          // ← 横並びレイアウトに変更！
        flexDirection: "row",
        overflow: "hidden",
        position: "relative",
      }}
    >
    {/* 左上のロゴ */}
      <img
        src="/logo.png"
        alt="Company Logo"
        style={{
          position: "absolute",
          left: "16px",
          top: "16px",
          width: "90px",
          height: "auto",
          opacity: 0.9,
          zIndex: 10,
        }}
      />
      {/* 左側：Plotly 描画エリア */}
      <div
        style={{
          width: "75%",           // ← グラフの幅を縮小（お好みで調整OK）
          height: "75%",
          position: "relative",
        }}
      >
        <div ref={plotRef} style={{ width: "100%", height: "100%" }} />
      </div>
  
      {/* 右側：UI パネル（縦に並ぶ入力欄 + ボタン） */}
      <div
        style={{
          width: "25%",           // ← UI 用の固定エリア
          height: "100%",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          backgroundColor: "rgba(0, 0, 0, 0.15)", // ちょい薄い背景
          boxSizing: "border-box",
        }}
      >
        {/* 入力欄1 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ color: "white", fontSize: "14px" }}>掃引間隔</label>
          <input
            type="text"
            placeholder="入力してください"
            style={{
              height: "32px",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid #ccc",
            }}
          />
        </div>
  
        {/* 入力欄2 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ color: "white", fontSize: "14px" }}>掃引範囲</label>
          <input
            type="text"
            placeholder="入力してください"
            style={{
              height: "32px",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid #ccc",
            }}
          />
        </div>
  
        {/* 入力欄3 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={{ color: "white", fontSize: "14px" }}>次の掃引までの時間間隔</label>
          <input
            type="text"
            placeholder="入力してください"
            style={{
              height: "32px",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid #ccc",
            }}
          />
        </div>
  
        {/* 軸ボタン */}
        <button onClick={() => setAxisVisible(v => !v)}>
          {axisVisible ? "軸を非表示" : "軸を表示"}
        </button>
  
        {/* 描画ボタン */}
        <button>3Dグラフを表示</button>
      </div>
    </div>
  );
}

export default App;
