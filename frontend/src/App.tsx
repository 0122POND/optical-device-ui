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

  // ★ 確認ダイアログの表示フラグ
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!plotRef.current) return;

    // データ生成
    let zData = generateCoinData(80);
    zData = addNoise(zData, 0.1);

    const data = [
      {
        z: zData,
        type: "surface" as const,
        colorbar: {
          x: 1.02,
          thickness: 15,
        },
      },
    ];

    const layout = {
      title: "Sample 3D Coin-like Surface",
      autosize: true,
      margin: {
        l: 0,
        r: 20,
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
        aspectratio: { x: 1, y: 1, z: 0.6 },
      },
    };

    const config = {
      responsive: true,
      displaylogo: false,
    };

    Plotly.newPlot(plotRef.current, data as any, layout as any, config as any);

    return () => {
      if (plotRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, [axisVisible]);

  // 「はい」が押されたときの処理
  const handleStartMeasurement = () => {
    setShowConfirm(false);
    // TODO: ここに「3次元形状計測開始」の処理を書く
    console.log("3次元形状計測を開始します");
  };

  return (
    <>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          overflow: "hidden",
          backgroundColor: "#121212",
          color: "#fff",
          boxSizing: "border-box",
        }}
      >
        {/* ▼ 左：サイドパネル（ロゴ + 入力UI） */}
        <div
          style={{
            height: "100%",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            backgroundColor: "#232323",
            boxSizing: "border-box",
            borderRight: "1px solid #444",
          }}
        >
          {/* ロゴ */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <img
              src="/logo.png"
              alt="Company Logo"
              style={{ width: "72px", height: "auto", opacity: 0.9 }}
            />
          </div>

          {/* セクションタイトル */}
          <div style={{ fontSize: "14px", fontWeight: 600, opacity: 0.85 }}>
            スキャン設定
          </div>

          {/* 掃引間隔 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "13px" }}>掃引間隔</label>
            <input
              type="text"
              placeholder="入力してください"
              style={{
                height: "32px",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid #555",
                backgroundColor: "#181818",
                color: "#fff",
              }}
            />
          </div>

          {/* 掃引範囲 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "13px" }}>掃引範囲</label>
            <input
              type="text"
              placeholder="入力してください"
              style={{
                height: "32px",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid #555",
                backgroundColor: "#181818",
                color: "#fff",
              }}
            />
          </div>

          {/* 次の掃引までの時間間隔 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "13px" }}>次の掃引までの時間間隔</label>
            <input
              type="text"
              placeholder="入力してください"
              style={{
                height: "32px",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid #555",
                backgroundColor: "#181818",
                color: "#fff",
              }}
            />
          </div>

          {/* 区切り */}
          <div
            style={{
              height: "1px",
              backgroundColor: "#333",
              margin: "8px 0",
            }}
          />

          {/* 軸トグルボタン */}
          <button
            onClick={() => setAxisVisible(v => !v)}
            style={{
              height: "36px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: axisVisible ? "#444" : "#222",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {axisVisible ? "軸を非表示" : "軸を表示"}
          </button>

          {/* 3D描画ボタン → 押すと確認モーダルを表示 */}
        <button
          style={{
            height: "40px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#1976d2",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
            marginTop: "4px",
          }}
          onClick={() => setShowConfirm(true)}
        >
          3Dグラフを表示
        </button>

        {/* ▼ CSV出力ボタン（緑色） */}
        <button
          style={{
            height: "40px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#2e7d32", // 緑っぽい色
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
            marginTop: "8px",
          }}
          onClick={() => {
            // TODO: ここに CSV 出力処理を実装
            console.log("CSVファイルを出力します");
          }}
        >
          csvファイルを出力
        </button>

        <div style={{ flexGrow: 1 }} />
        </div>

        {/* ▼ 右：3D Plot エリア */}
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: "12px",
            boxSizing: "border-box",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div ref={plotRef} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>

      {/* ▼ 確認モーダル */}
      {showConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "320px",
              backgroundColor: "#2b2b2b",
              borderRadius: "10px",
              padding: "20px 24px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize: "15px",
                marginBottom: "16px",
                fontWeight: 500,
              }}
            >
              3次元形状計測を開始しますか？
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
              }}
            >
              <button
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "#444",
                  color: "#fff",
                  cursor: "pointer",
                }}
                onClick={() => setShowConfirm(false)}
              >
                いいえ
              </button>
              <button
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "#1976d2",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onClick={handleStartMeasurement}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
