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

function downloadCSV(zData: (number | null)[][], filename = "surface.csv") {
  const rows = zData.map(row =>
    row.map(v => (v == null ? "" : v.toString())).join(",")
  );
  const csv = rows.join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}


function App() {
  const GRID_SIZE = 80;
  const plotRef = useRef<HTMLDivElement | null>(null);
  const sliceRef = useRef<HTMLDivElement | null>(null);

  // 軸表示フラグ（true = 表示 / false = 非表示）
  const [axisVisible, setAxisVisible] = useState(true);

  // 確認ダイアログの表示フラグ
  const [showConfirm, setShowConfirm] = useState(false);

  // 確認ダイアログの種類（3D開始 or CSV出力）
  const [confirmMode, setConfirmMode] = useState<"plot" | "csv" | null>(null);

  // 3Dグラフを表示するかどうか
  const [showPlot, setShowPlot] = useState(false);

  // 断層グラフを表示するかどうか
  const [showSlice, setShowSlice] = useState(false);

  // どの行を断層として使うか（ここでは y方向の中央）
  const [sliceIndex] = useState(Math.floor(GRID_SIZE / 2));

   // 掃引関連の入力値 & 単位
  const [sweepInterval, setSweepInterval] = useState("");
  const [sweepRange, setSweepRange] = useState("");
  const [sweepIntervalUnit, setSweepIntervalUnit] = useState<"um" | "mm">("um");
  const [sweepRangeUnit, setSweepRangeUnit] = useState<"um" | "mm">("um");

  // 次の掃引までの時間間隔 & 単位 (s / ms)
  const [sweepTimeInterval, setSweepTimeInterval] = useState("");
  const [sweepTimeUnit, setSweepTimeUnit] = useState<"s" | "ms">("s");

  const [zData, setZData] = useState<(number | null)[][] | null>(null);

  const unitSelectStyle: React.CSSProperties = {
    height: "32px",
    padding: "0 10px",
    borderRadius: "6px",
    border: "1px solid #555",
    backgroundColor: "#181818",
    color: "#fff",
    fontSize: "12px",
    cursor: "pointer",
    outline: "none",
  };

  const StatusBadge = ({ running }: { running: boolean }) => {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 10px",
          borderRadius: "999px",
          fontSize: "12px",
          fontWeight: 600,
          backgroundColor: running ? "#2e1f1f" : "#1f2e1f",
          color: running ? "#ff6b6b" : "#6bff95",
          border: `1px solid ${running ? "#ff6b6b55" : "#6bff9555"}`,
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: running ? "#ff4d4d" : "#3ddc84",
          }}
        />
        {running ? "RUNNING" : "READY"}
      </div>
    );
  };

useEffect(() => {
  if (!plotRef.current) return;

  if (!showPlot) {
    Plotly.purge(plotRef.current);
    return;
  }

  // データ生成
  let z = generateCoinData(GRID_SIZE);
  z = addNoise(z, 0.1);
  setZData(z); // ★ state に保存

  const data = [
    {
      z,
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
  }, [axisVisible, showPlot]);

// --- 2D 断層グラフ描画 ---
useEffect(() => {
  if (!sliceRef.current) return;

  // 非表示またはデータなしなら purge
  if (!showSlice || !zData) {
    Plotly.purge(sliceRef.current);
    return;
  }

  // 断層として使う 1 行（y = sliceIndex）のデータ
  const row = zData[sliceIndex];
  const x = row.map((_, i) => i);
  const y = row.map(v => (v == null ? 0 : v)); // null は 0 扱いにしておく

  const data = [
    {
      x,
      y,
      type: "scatter" as const,
      mode: "lines",
    },
  ];

  const layout = {
    title: `断層（y = ${sliceIndex}）`,
    margin: { l: 40, r: 10, t: 30, b: 40 },
    xaxis: { title: "X index" },
    yaxis: { title: "Height" },
    height: 250,
    paper_bgcolor: "#121212",
    plot_bgcolor: "#121212",
    font: { color: "#fff" },
  };

  const config = {
    responsive: true,
    displaylogo: false,
  };

  Plotly.newPlot(sliceRef.current, data as any, layout as any, config as any);

  return () => {
    if (sliceRef.current) {
      Plotly.purge(sliceRef.current);
    }
  };
  }, [showSlice, zData, sliceIndex]);

// 「はい」が押されたときの処理（モードごとに分岐）
  const handleConfirmOk = () => {
    if (confirmMode === "plot") {
      setShowPlot(true);
      console.log("3次元形状計測を開始します");
    } else if (confirmMode === "csv") {
// zData があればそれを書き出し、なければその場で生成して出力
      if (zData) {
        downloadCSV(zData, "surface.csv");
      } else {
        const fallback = addNoise(generateCoinData(GRID_SIZE), 0.1);
        downloadCSV(fallback, "surface.csv");
      }
    }
  
    setShowConfirm(false);
    setConfirmMode(null);
  };
  

  // 「いいえ」の処理
  const handleConfirmCancel = () => {
    setShowConfirm(false);
    setConfirmMode(null);
  };

  return (
    <>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "grid",
          gridTemplateRows: "56px 1fr", // ← ヘッダー + メイン
          backgroundColor: "#2d2d2d",
          color: "#fff",
        }}
      >
      
      {/* ▼ ヘッダー */}
      <div
        style={{
          height: "48px",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          backgroundColor: "#1f1f1f",
          borderBottom: "1px solid #444",
          boxSizing: "border-box",
          gap: "10px",
        }}
      >
        {/* ロゴ */}
        <img
          src="/logo.jpg"
          alt="Company Logo"
          style={{ height: "28px", width: "auto", opacity: 0.95 }}
        />

        {/* タイトル */}
        <div style={{ fontWeight: 600, fontSize: "15px" }}>
          3D Surface Measurement UI
        </div>

        {/* 右寄せエリア */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          {/* ★ ステータス表示 */}
          <StatusBadge running={showPlot} />

          {/* バージョン */}
          <div style={{ fontSize: "12px", color: "#aaa" }}>
            Ver. 0.1
          </div>
        </div>
      </div>


      {/* ▼ メインエリア（←ここが “2行目”） */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          height: "100%",
          overflow: "hidden",
        }}
      >    


        {/* ▼ 左：サイドパネル */}
        <div
          style={{
            height: "100%",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            backgroundColor: "#2d2d2d",
            boxSizing: "border-box",
            borderRight: "1px solid #444",
          }}
        >

          {/* セクションタイトル */}
          <div style={{ fontSize: "14px", fontWeight: 600, opacity: 0.85 }}>
            スキャン設定
          </div>

          {/* 掃引間隔 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "13px" }}>掃引間隔</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                placeholder="入力してください"
                value={sweepInterval}
                onChange={e => setSweepInterval(e.target.value)}
                style={{
                  flex: 1,
                  height: "32px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid #555",
                  backgroundColor: "#181818",
                  color: "#fff",
                }}
              />
                <select
                  value={sweepIntervalUnit}
                  onChange={(e) => setSweepIntervalUnit(e.target.value as "um" | "mm")}
                  style={unitSelectStyle}
                >
                  <option value="um">µm</option>
                  <option value="mm">mm</option>
                </select>
              
            </div>
          </div>

          {/* 掃引範囲 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "13px" }}>掃引範囲</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                placeholder="入力してください"
                value={sweepRange}
                onChange={e => setSweepRange(e.target.value)}
                style={{
                  flex: 1,
                  height: "32px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid #555",
                  backgroundColor: "#181818",
                  color: "#fff",
                }}
              />
              <select
                value={sweepIntervalUnit}
                onChange={(e) => setSweepRangeUnit(e.target.value as "um" | "mm")}
                style={unitSelectStyle}
              >
                <option value="um">µm</option>
                <option value="mm">mm</option>
              </select>
            </div>
          </div>

          {/* 次の掃引までの時間間隔 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "13px" }}>次の掃引までの時間間隔</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                placeholder="入力してください"
                value={sweepTimeInterval}
                onChange={e => setSweepTimeInterval(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: "32px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid #555",
                  backgroundColor: "#181818",
                  color: "#fff",
                }}
              />
              <select
                value={sweepIntervalUnit}
                onChange={(e) => setSweepTimeUnit(e.target.value as "ms" | "s")}
                style={unitSelectStyle}
              >
                <option value="ms">ms</option>
                <option value="s">s</option>
              </select>
              
            </div>
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
            onClick={() => {
              setConfirmMode("plot");
              setShowConfirm(true);
            }}
          >
            START
          </button>

          {/* CSV出力ボタン（緑） */}
          <button
            style={{
              height: "40px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#2e7d32",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "8px",
            }}
            onClick={() => {
              setConfirmMode("csv");
              setShowConfirm(true);
            }}
          >
            csvファイルを出力
          </button>

          {/* ★ 断層を出力ボタン */}
          <button
            style={{
              height: "40px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#555",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "8px",
            }}
            onClick={() => {
              // まだ 3D を開始していない場合は、その場でデータ生成
              if (!zData) {
                const generated = addNoise(
                  generateCoinData(GRID_SIZE),
                  0.1
                );
                setZData(generated);
              }
              setShowSlice(true);
            }}
          >
            断層を出力
          </button>          

          <div style={{ flexGrow: 1 }} />
        </div>

        {/* ▼ 右：3D Plot + 2D断層 エリア */}
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: "12px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {/* 上：3D */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <div
              ref={plotRef}
              style={{ width: "100%", height: "100%", position: "relative" }}
            >
              {/* まだ showPlot=false のときは案内メッセージを表示 */}
              {!showPlot && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#777",
                    fontSize: "15px",
                  }}
                >
                  左側の「START」ボタンから
                  <br />
                  3次元形状計測を開始してください。
                </div>
              )}
            </div>
          </div>

          {/* 下：2D 断層グラフ（showSlice のときだけ表示） */}
          {showSlice && (
            <div style={{ height: "260px" }}>
              <div
                ref={sliceRef}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          )}
        </div>
      </div>
    </div>

      {/* ▼ 確認モーダル */}
      {showConfirm && confirmMode && (
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
              {confirmMode === "csv"
                ? "csvファイルを出力しますか？"
                : "3次元形状計測を開始しますか？"}
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
                onClick={handleConfirmCancel}
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
                onClick={handleConfirmOk}
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
